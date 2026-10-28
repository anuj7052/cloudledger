import pytest

from core.config import settings
from routers import billing as customer_routes, billing_ledger as ledger_routes, billing_reminders as routes
from tests.test_billing_ledger import db  # noqa: F401

U = {'account_id': 1, 'user_id': 'one', 'actor_id': 1}


@pytest.mark.asyncio
async def test_pending_by_month_and_test_mail_only_after_approval(db, monkeypatch):  # noqa: F811
    c = await customer_routes.create_customer(customer_routes.CustomerInput(name='Due Co', contact_email='ap@dueco.in'), U, db)
    w = await ledger_routes.create_workload(c['id'], ledger_routes.WorkloadInput(name='Prod'), U, db)
    await ledger_routes.create_entry(w['id'], ledger_routes.EntryInput(period='2026-08', currency='INR', invoice_number='I-8', customer_amount='1000', received_amount='400'), U, db)
    await ledger_routes.create_entry(w['id'], ledger_routes.EntryInput(period='2026-09', currency='INR', invoice_number='I-9', customer_amount='500'), U, db)
    await ledger_routes.create_entry(w['id'], ledger_routes.EntryInput(period='2026-10', currency='INR', invoice_number='I-10', customer_amount='300', received_amount='300'), U, db)
    monkeypatch.setattr(settings, 'ACS_CONNECTION_STRING', 'x'); monkeypatch.setattr(settings, 'ACS_SENDER', 's@x'); monkeypatch.setattr(settings, 'BILLING_TEST_MAIL_TO', 'tester@foetron.com')
    data = await routes.pending_bills(U, db)
    item = data['items'][0]
    assert item['total_due'] == '1100.00' and [m['period'] for m in item['months']] == ['2026-08', '2026-09']
    sent = []
    monkeypatch.setattr(routes, 'send_mail', lambda to, s, b: sent.append((to, s, b)))
    assert not sent  # listing never sends
    r = await routes.approve_and_send(c['id'], routes.ApproveInput(), U, db)
    assert r['to'] == 'tester@foetron.com' and sent[0][0] == 'tester@foetron.com' and 'ap@dueco.in' in sent[0][1] and 'I-8' in sent[0][2]
    assert (await routes.reminder_history(U, db))['items'][0]['status'] == 'sent'
