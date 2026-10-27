"""One invoice for a whole customer/tenant, split by charge type and subscription.

Stored separately from monthly subscription entries so existing records are
never rewritten. Each line is a charge type (pay-as-you-go, monthly RI,
one-time RI...) with its billed and distributor amounts, optionally split
across the customer's subscriptions.
"""
import json
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from auth.dependencies import get_current_user, require_workspace_admin
from core.db import get_db
from services import billing_ledger as ledger

router = APIRouter(prefix='/api/billing', tags=['Azure Billing combined bills'])
LINE_TYPES = ('Pay-as-you-go', 'Monthly RI', 'One-time RI', 'Savings plan', 'Licence / subscription', 'Marketplace', 'Other')
MONEY = dict(max_digits=18, decimal_places=4, allow_inf_nan=False)


class Line(BaseModel):
    type: Literal[LINE_TYPES]
    amount: Decimal = Field(ge=0, **MONEY)
    distributor_amount: Decimal | None = Field(default=None, ge=0, **MONEY)
    split: dict[str, Decimal] = Field(default_factory=dict)

    @model_validator(mode='after')
    def split_adds_up(self):
        if self.split and abs(sum(self.split.values(), Decimal(0)) - self.amount) > Decimal('0.01'):
            raise ValueError(f'{self.type}: the subscription split must add up to the line amount.')
        return self


class BillInput(BaseModel):
    period: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    invoice_number: str = Field(default='', max_length=200)
    distributor: str = Field(default='', max_length=120)
    distributor_invoice: str = Field(default='', max_length=200)
    currency: str = Field(default='INR', pattern=r'^[A-Z]{3}$')
    amount_basis: Literal['gross', 'net'] = 'gross'
    lines: list[Line] = Field(min_length=1, max_length=20)
    received_amount: Decimal | None = Field(default=None, ge=0, **MONEY)
    payment_status: str = Field(default='', max_length=1000)


def output(row):
    out = dict(row)
    out['lines'] = json.loads(out['lines'] or '[]')
    return out


async def one(db, sql, args):
    async with db.execute(sql, args) as cursor:
        row = await cursor.fetchone()
    return dict(row) if row else None


async def check(db, owner, customer_id, body):
    await ledger.get_entity(db, owner, 'customer', customer_id)
    async with db.execute('SELECT id FROM billing_workloads WHERE owner_id=? AND customer_id=?', (owner, customer_id)) as cursor:
        allowed = {r[0] for r in await cursor.fetchall()}
    for line in body.lines:
        if set(line.split) - allowed:
            raise HTTPException(422, 'Split only across this customer\'s own subscriptions.')


def encode(body):
    return json.dumps([{'type': l.type, 'amount': str(l.amount), 'distributor_amount': None if l.distributor_amount is None else str(l.distributor_amount),
                        'split': {k: str(v) for k, v in l.split.items() if v}} for l in body.lines])


@router.get('/customers/{customer_id}/combined-bills')
async def list_bills(customer_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    owner = user['account_id']
    await ledger.get_entity(db, owner, 'customer', customer_id)
    async with db.execute('SELECT * FROM billing_combined_bills WHERE owner_id=? AND customer_id=? ORDER BY period DESC, created_at DESC', (owner, customer_id)) as cursor:
        return {'items': [output(r) for r in await cursor.fetchall()], 'types': list(LINE_TYPES)}


@router.post('/customers/{customer_id}/combined-bills', status_code=201)
async def create_bill(customer_id: str, body: BillInput, user=Depends(require_workspace_admin), db=Depends(get_db)):
    owner = user['account_id']
    await check(db, owner, customer_id, body)
    key = str(uuid.uuid4())
    await db.execute('INSERT INTO billing_combined_bills(id,owner_id,customer_id,period,invoice_number,distributor,distributor_invoice,currency,amount_basis,lines,received_amount,payment_status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (key, owner, customer_id, body.period, body.invoice_number.strip(), body.distributor.strip(), body.distributor_invoice.strip(), body.currency, body.amount_basis, encode(body),
                      None if body.received_amount is None else str(body.received_amount), body.payment_status.strip(), user['user_id']))
    await ledger.audit(db, owner, user['user_id'], 'combined_bill', key, 'create', {}, body.model_dump(mode='json'))
    await db.commit()
    return output(await one(db, 'SELECT * FROM billing_combined_bills WHERE id=?', (key,)))


@router.put('/combined-bills/{bill_id}')
async def update_bill(bill_id: str, body: BillInput, user=Depends(require_workspace_admin), db=Depends(get_db)):
    owner = user['account_id']
    before = await one(db, 'SELECT * FROM billing_combined_bills WHERE owner_id=? AND id=?', (owner, bill_id))
    if not before:
        raise HTTPException(404, 'Bill not found.')
    await check(db, owner, before['customer_id'], body)
    await db.execute('UPDATE billing_combined_bills SET period=?,invoice_number=?,distributor=?,distributor_invoice=?,currency=?,amount_basis=?,lines=?,received_amount=?,payment_status=? WHERE owner_id=? AND id=?',
                     (body.period, body.invoice_number.strip(), body.distributor.strip(), body.distributor_invoice.strip(), body.currency, body.amount_basis, encode(body),
                      None if body.received_amount is None else str(body.received_amount), body.payment_status.strip(), owner, bill_id))
    await ledger.audit(db, owner, user['user_id'], 'combined_bill', bill_id, 'update', before, body.model_dump(mode='json'))
    await db.commit()
    return output(await one(db, 'SELECT * FROM billing_combined_bills WHERE id=?', (bill_id,)))


@router.delete('/combined-bills/{bill_id}')
async def delete_bill(bill_id: str, user=Depends(require_workspace_admin), db=Depends(get_db)):
    owner = user['account_id']
    before = await one(db, 'SELECT * FROM billing_combined_bills WHERE owner_id=? AND id=?', (owner, bill_id))
    if not before:
        raise HTTPException(404, 'Bill not found.')
    await db.execute('DELETE FROM billing_combined_bills WHERE owner_id=? AND id=?', (owner, bill_id))
    await ledger.audit(db, owner, user['user_id'], 'combined_bill', bill_id, 'delete', before, {})
    await db.commit()
    return {'deleted': True}
