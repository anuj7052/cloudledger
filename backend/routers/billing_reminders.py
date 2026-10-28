"""Pending bills, month by month, and payment-reminder mails that are sent only
after an admin approves them. While BILLING_TEST_MAIL_TO is set, every mail goes
to that test address instead of the customer."""
import asyncio
import html
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_workspace_admin
from core.config import settings
from core.db import get_db
from services import billing_ledger as ledger

router = APIRouter(prefix='/api/billing', tags=['Azure Billing reminders'])
ZERO = Decimal(0)


def money(v):
    return f'INR {v:,.2f}'


async def pending(db, owner, customer_id=''):
    sql = ("SELECT l.id,l.customer_id,l.period,l.invoice_number,l.customer_amount,l.received_amount,l.payment_status,l.currency,w.name AS workload,c.name AS customer,c.contact_email "
           "FROM billing_ledger l JOIN billing_workloads w ON w.id=l.workload_id JOIN billing_customers c ON c.id=l.customer_id "
           "WHERE l.owner_id=? AND l.customer_amount IS NOT NULL AND l.status<>'needs_review' "
           "AND NOT EXISTS (SELECT 1 FROM billing_archives a WHERE a.owner_id=l.owner_id AND ((a.entity_type='entry' AND a.entity_id=l.id) OR (a.entity_type='workload' AND a.entity_id=l.workload_id) OR (a.entity_type='customer' AND a.entity_id=l.customer_id)))")
    args = [owner]
    if customer_id:
        sql += ' AND l.customer_id=?'
        args.append(customer_id)
    async with db.execute(sql + ' ORDER BY c.name, l.period', args) as cursor:
        rows = [dict(r) for r in await cursor.fetchall()]
    customers = {}
    for r in rows:
        billed = Decimal(r['customer_amount'])
        received = Decimal(r['received_amount']) if r['received_amount'] not in (None, '') else ZERO
        due = billed - received
        if due <= Decimal('0.005'):
            continue
        c = customers.setdefault(r['customer_id'], {'customer_id': r['customer_id'], 'customer': r['customer'], 'email': r['contact_email'] or '', 'months': {}, 'total_due': ZERO, 'invoices': 0})
        m = c['months'].setdefault(r['period'], {'period': r['period'], 'billed': ZERO, 'received': ZERO, 'due': ZERO, 'invoices': []})
        m['billed'] += billed; m['received'] += received; m['due'] += due
        m['invoices'].append({'invoice_number': r['invoice_number'], 'subscription': r['workload'], 'billed': f'{billed:.2f}', 'received': f'{received:.2f}', 'due': f'{due:.2f}', 'remark': r['payment_status']})
        c['total_due'] += due; c['invoices'] += 1
    out = []
    for c in sorted(customers.values(), key=lambda x: -x['total_due']):
        months = [{**m, 'billed': f"{m['billed']:.2f}", 'received': f"{m['received']:.2f}", 'due': f"{m['due']:.2f}"} for m in sorted(c['months'].values(), key=lambda m: m['period'])]
        out.append({**c, 'months': months, 'total_due': f"{c['total_due']:.2f}"})
    return out


def compose(c):
    from datetime import date
    rows = ''.join(
        f"<tr><td style='padding:6px 10px;border:1px solid #e5e7eb'>{date.fromisoformat(m['period'] + '-01').strftime('%b %Y')}</td>"
        f"<td style='padding:6px 10px;border:1px solid #e5e7eb'>{html.escape(', '.join(i['invoice_number'] or '-' for i in m['invoices']))}</td>"
        f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>{money(Decimal(m['billed']))}</td>"
        f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>{money(Decimal(m['received']))}</td>"
        f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:600'>{money(Decimal(m['due']))}</td></tr>" for m in c['months'])
    subject = f"Payment reminder: {money(Decimal(c['total_due']))} pending — {c['customer']}"
    body = (f"<p>Dear {html.escape(c['customer'])},</p><p>Our records show the following amounts are pending. Please arrange the payment at the earliest.</p>"
            f"<table style='border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px'><tr style='background:#fff7ed'>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:left'>Month</th><th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:left'>Invoice</th>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb'>Billed</th><th style='padding:6px 10px;border:1px solid #e5e7eb'>Received</th><th style='padding:6px 10px;border:1px solid #e5e7eb'>Pending</th></tr>"
            f"{rows}<tr><td colspan='4' style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:600'>Total pending</td>"
            f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:700'>{money(Decimal(c['total_due']))}</td></tr></table>"
            "<p>If you have already paid, please share the payment details and ignore this mail.</p><p>Regards,<br>Foetron Billing</p>")
    return subject, body


def send_mail(to, subject, body):
    from azure.communication.email import EmailClient
    client = EmailClient.from_connection_string(settings.ACS_CONNECTION_STRING)
    poller = client.begin_send({'senderAddress': settings.ACS_SENDER, 'recipients': {'to': [{'address': to}]},
                                'content': {'subject': subject, 'html': body}})
    return poller.result(timeout=60)


@router.get('/pending-bills')
async def pending_bills(user=Depends(get_current_user), db=Depends(get_db)):
    items = await pending(db, user['account_id'])
    async with db.execute('SELECT customer_id, MAX(created_at) FROM billing_reminders WHERE owner_id=? AND status=? GROUP BY customer_id', (user['account_id'], 'sent')) as cursor:
        last = {r[0]: r[1] for r in await cursor.fetchall()}
    for c in items:
        c['last_reminder'] = last.get(c['customer_id'], '')
    total = sum((Decimal(c['total_due']) for c in items), ZERO)
    return {'items': items, 'total_due': f'{total:.2f}', 'test_mode': bool(settings.BILLING_TEST_MAIL_TO), 'test_to': settings.BILLING_TEST_MAIL_TO,
            'mail_ready': bool(settings.ACS_CONNECTION_STRING and settings.ACS_SENDER)}


@router.get('/pending-bills/{customer_id}/preview')
async def preview(customer_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    items = await pending(db, user['account_id'], customer_id)
    if not items:
        raise HTTPException(404, 'Nothing pending for this customer.')
    subject, body = compose(items[0])
    to = settings.BILLING_TEST_MAIL_TO or items[0]['email']
    return {'to': to, 'customer_email': items[0]['email'], 'subject': subject, 'html': body, 'test_mode': bool(settings.BILLING_TEST_MAIL_TO)}


class ApproveInput(BaseModel):
    note: str = Field(default='', max_length=500)


@router.post('/pending-bills/{customer_id}/send')
async def approve_and_send(customer_id: str, body: ApproveInput, user=Depends(require_workspace_admin), db=Depends(get_db)):
    """Sends only when an admin clicks Approve & send. Never automatic."""
    owner = user['account_id']
    if not (settings.ACS_CONNECTION_STRING and settings.ACS_SENDER):
        raise HTTPException(503, 'Mail is not configured on the server.')
    items = await pending(db, owner, customer_id)
    if not items:
        raise HTTPException(404, 'Nothing pending for this customer.')
    c = items[0]
    to = settings.BILLING_TEST_MAIL_TO or c['email']
    if not to:
        raise HTTPException(422, 'This customer has no email. Add one in Company details.')
    subject, html_body = compose(c)
    if settings.BILLING_TEST_MAIL_TO:
        subject = f'[TEST — would go to {c["email"] or "no email set"}] ' + subject
    key = str(uuid.uuid4())
    try:
        await asyncio.to_thread(send_mail, to, subject, html_body)
        status, error = 'sent', ''
    except Exception as exc:  # recorded, then reported
        status, error = 'failed', str(exc)[:500]
    await db.execute('INSERT INTO billing_reminders(id,owner_id,customer_id,sent_to,subject,body,total_due,approved_by,status,error) VALUES(?,?,?,?,?,?,?,?,?,?)',
                     (key, owner, customer_id, to, subject, html_body, c['total_due'], user['user_id'], status, error))
    await ledger.audit(db, owner, user['user_id'], 'reminder', key, 'create', {}, {'customer_id': customer_id, 'description': f"Payment reminder {status} to {to} — INR {c['total_due']} pending", 'note': body.note})
    await db.commit()
    if status != 'sent':
        raise HTTPException(502, 'The mail service did not accept the message. Try again later.')
    return {'sent': True, 'to': to, 'total_due': c['total_due']}


@router.get('/reminders')
async def reminder_history(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT r.id,r.customer_id,c.name AS customer,r.sent_to,r.subject,r.total_due,r.status,r.created_at,u.name AS approved_by FROM billing_reminders r LEFT JOIN billing_customers c ON c.id=r.customer_id LEFT JOIN users u ON u.azure_oid=r.approved_by WHERE r.owner_id=? ORDER BY r.created_at DESC LIMIT 200", (user['account_id'],)) as cursor:
        return {'items': [dict(r) for r in await cursor.fetchall()]}
