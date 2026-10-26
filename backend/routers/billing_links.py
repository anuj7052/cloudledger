"""Map Azure subscriptions (from the signed-in tenant) to Azure Billing customers."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_workspace_admin
from core.db import get_db
from services import billing_ledger as ledger
from services.billing_links import best_match, remove_service_notes, sync_service_notes

router = APIRouter(prefix='/api/billing', tags=['Azure Billing mapping'])
AUTO_THRESHOLD = 0.6


class AzureSub(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(default='', max_length=300)


class SuggestInput(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=100)
    subscriptions: list[AzureSub] = Field(max_length=2000)


class LinkInput(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=100)
    subscription_id: str = Field(min_length=1, max_length=100)
    azure_name: str = Field(default='', max_length=300)
    customer_id: str = Field(min_length=1, max_length=64)
    workload_id: str = Field(default='', max_length=64)


class AssignInput(BaseModel):
    service_id: str = Field(default='', max_length=64)


async def rows(db, sql, args):
    async with db.execute(sql, args) as cursor:
        return [dict(r) for r in await cursor.fetchall()]


async def active_names(db, owner):
    customers = await rows(db, "SELECT id,name FROM billing_customers c WHERE owner_id=? AND NOT EXISTS (SELECT 1 FROM billing_archives a WHERE a.owner_id=c.owner_id AND a.entity_type='customer' AND a.entity_id=c.id)", (owner,))
    workloads = await rows(db, "SELECT id,customer_id,name FROM billing_workloads w WHERE owner_id=? AND NOT EXISTS (SELECT 1 FROM billing_archives a WHERE a.owner_id=w.owner_id AND a.entity_type='workload' AND a.entity_id=w.id)", (owner,))
    return customers, workloads


@router.post('/azure-links/suggest')
async def suggest(body: SuggestInput, user=Depends(get_current_user), db=Depends(get_db)):
    """Saved links plus fuzzy matches. Admins' unmatched subscriptions are auto-linked when the match is strong."""
    owner = user['account_id']
    customers, workloads = await active_names(db, owner)
    saved = {r['subscription_id']: r for r in await rows(db, 'SELECT * FROM billing_azure_links WHERE owner_id=? AND tenant_id=?', (owner, body.tenant_id))}
    can_save = bool(user.get('can_administer'))
    out, created = [], 0
    for sub in body.subscriptions:
        link = saved.get(sub.id)
        guess = best_match(sub.name, customers, workloads)
        if link and link['method'] == 'auto' and can_save and (link['customer_id'], link['workload_id']) != (guess['customer_id'], guess['workload_id']):
            # Unconfirmed automatic matches are re-checked every time; confirmed ones never change.
            await db.execute('DELETE FROM billing_azure_links WHERE owner_id=? AND tenant_id=? AND subscription_id=?', (owner, body.tenant_id, sub.id))
            for service in await rows(db, 'SELECT * FROM billing_services WHERE owner_id=? AND workload_id=?', (owner, link['workload_id'])):
                await sync_service_notes(db, owner, service, user)
            link = None
        if not link and can_save and guess['score'] >= AUTO_THRESHOLD:
            await db.execute('INSERT INTO billing_azure_links(owner_id,tenant_id,subscription_id,azure_name,customer_id,workload_id,method,score,updated_by) VALUES(?,?,?,?,?,?,?,?,?)',
                             (owner, body.tenant_id, sub.id, sub.name, guess['customer_id'], guess['workload_id'], 'auto', guess['score'], user['user_id']))
            link = {'customer_id': guess['customer_id'], 'workload_id': guess['workload_id'], 'method': 'auto', 'score': guess['score']}
            created += 1
            if guess['workload_id']:
                for service in await rows(db, 'SELECT * FROM billing_services WHERE owner_id=? AND workload_id=?', (owner, guess['workload_id'])):
                    await sync_service_notes(db, owner, service, user)
        out.append({'subscription_id': sub.id, 'azure_name': sub.name,
                    'customer_id': link['customer_id'] if link else '', 'workload_id': link['workload_id'] if link else '',
                    'method': link['method'] if link else 'none', 'score': (link or guess)['score'],
                    'suggested_customer_id': guess['customer_id'], 'suggested_workload_id': guess['workload_id']})
    if created:
        await db.commit()
    return {'items': out, 'auto_linked': created, 'customers': customers, 'workloads': workloads}


@router.put('/azure-links')
async def save_link(body: LinkInput, user=Depends(require_workspace_admin), db=Depends(get_db)):
    owner = user['account_id']
    await ledger.get_entity(db, owner, 'customer', body.customer_id)
    if body.workload_id:
        work = await ledger.get_entity(db, owner, 'workload', body.workload_id)
        if work['customer_id'] != body.customer_id:
            raise HTTPException(422, 'That billing subscription belongs to another customer.')
    old = await rows(db, 'SELECT workload_id FROM billing_azure_links WHERE owner_id=? AND tenant_id=? AND subscription_id=?', (owner, body.tenant_id, body.subscription_id))
    await db.execute('DELETE FROM billing_azure_links WHERE owner_id=? AND tenant_id=? AND subscription_id=?', (owner, body.tenant_id, body.subscription_id))
    await db.execute('INSERT INTO billing_azure_links(owner_id,tenant_id,subscription_id,azure_name,customer_id,workload_id,method,score,updated_by) VALUES(?,?,?,?,?,?,?,?,?)',
                     (owner, body.tenant_id, body.subscription_id, body.azure_name, body.customer_id, body.workload_id, 'manual', 1, user['user_id']))
    affected = {body.workload_id} | {o['workload_id'] for o in old}
    for wid in filter(None, affected):
        for service in await rows(db, 'SELECT * FROM billing_services WHERE owner_id=? AND workload_id=?', (owner, wid)):
            await sync_service_notes(db, owner, service, user)
    await ledger.audit(db, owner, user['user_id'], 'azure_link', body.subscription_id, 'map', old[0] if old else {}, body.model_dump())
    await db.commit()
    return {'saved': True}


@router.delete('/azure-links')
async def remove_link(tenant_id: str = Query(...), subscription_id: str = Query(...), user=Depends(require_workspace_admin), db=Depends(get_db)):
    owner = user['account_id']
    await db.execute("DELETE FROM cost_notes WHERE owner_id=? AND source='billing' AND tenant_id=? AND subscription_id=?", (owner, tenant_id, subscription_id))
    await db.execute('DELETE FROM billing_azure_links WHERE owner_id=? AND tenant_id=? AND subscription_id=?', (owner, tenant_id, subscription_id))
    await db.commit()
    return {'deleted': True}


@router.get('/azure-links/services')
async def services_for_azure(tenant_id: str = Query(...), subscription_ids: list[str] = Query(default=[]), user=Depends(get_current_user), db=Depends(get_db)):
    """PO/BOQ services available to explain notes for these Azure subscriptions (all mapped ones when none given)."""
    owner = user['account_id']
    links = await rows(db, 'SELECT subscription_id, workload_id, customer_id FROM billing_azure_links WHERE owner_id=? AND tenant_id=?', (owner, tenant_id))
    if subscription_ids:
        links = [l for l in links if l['subscription_id'] in subscription_ids]
    customers = {l['customer_id'] for l in links}
    if not customers:
        return {'items': []}
    marks = ','.join('?' for _ in customers)
    items = await rows(db, f'SELECT s.id,s.name,s.po_number,s.po_date,s.boq_ref,s.activated_on,s.status,s.monthly_cost,s.currency,c.name AS customer FROM billing_services s JOIN billing_customers c ON c.id=s.customer_id WHERE s.owner_id=? AND s.customer_id IN ({marks}) ORDER BY s.activated_on DESC', (owner, *customers))
    return {'items': items}


@router.put('/cost-notes/{note_id}/service')
async def assign_note(note_id: str, body: AssignInput, user=Depends(require_workspace_admin), db=Depends(get_db)):
    """Owner links a dashboard note to the PO/BOQ service that explains it."""
    owner = user['account_id']
    if not await rows(db, 'SELECT id FROM cost_notes WHERE owner_id=? AND id=?', (owner, note_id)):
        raise HTTPException(404, 'Note not found.')
    if body.service_id and not await rows(db, 'SELECT id FROM billing_services WHERE owner_id=? AND id=?', (owner, body.service_id)):
        raise HTTPException(404, 'Service not found.')
    await db.execute('UPDATE cost_notes SET linked_service_id=? WHERE owner_id=? AND id=?', (body.service_id, owner, note_id))
    await db.commit()
    return {'saved': True}


__all__ = ['router', 'remove_service_notes']
