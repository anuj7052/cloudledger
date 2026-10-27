import pytest
from datetime import date
from pydantic import ValidationError

from routers import billing as customer_routes, billing_ledger as ledger_routes, billing_combined as routes
from services.billing_dashboard import load
from tests.test_billing_ledger import db  # noqa: F401

U = {'account_id': 1, 'user_id': 'one', 'actor_id': 1}


@pytest.mark.asyncio
async def test_tenant_bill_split_counts_once_and_keeps_entries(db):  # noqa: F811
    c = await customer_routes.create_customer(customer_routes.CustomerInput(name='Mill'), U, db)
    it = await ledger_routes.create_workload(c['id'], ledger_routes.WorkloadInput(name='IT'), U, db)
    sap = await ledger_routes.create_workload(c['id'], ledger_routes.WorkloadInput(name='SAP'), U, db)
    bill = await routes.create_bill(c['id'], routes.BillInput(period='2026-09', invoice_number='INV-1', distributor='Redington', amount_basis='net', lines=[
        {'type': 'Pay-as-you-go', 'amount': '1000', 'distributor_amount': '800', 'split': {it['id']: '400', sap['id']: '600'}},
        {'type': 'Monthly RI', 'amount': '500', 'distributor_amount': '450'},
        {'type': 'One-time RI', 'amount': '2000', 'distributor_amount': '1900', 'split': {sap['id']: '2000'}}]), U, db)
    assert len(bill['lines']) == 3
    row = (await load(db, 1, date(2026, 9, 1), date(2026, 9, 30)))['customers'][0]
    assert row['customer_amount'] == '3500.00' and row['distributor_amount'] == '3150.00' and row['profit'] == '350.00'
    with pytest.raises(ValidationError):
        routes.BillInput(period='2026-09', lines=[{'type': 'Pay-as-you-go', 'amount': '10', 'split': {it['id']: '3'}}])
    assert (await routes.delete_bill(bill['id'], U, db))['deleted']


def test_distributor_only_line_split_checks_distributor_amount():
    line = routes.Line(type='Monthly RI', distributor_amount='300', split={'a': '100', 'b': '200'})
    assert line.amount == 0
    with pytest.raises(ValidationError):
        routes.Line(type='Monthly RI', distributor_amount='300', split={'a': '100'})
