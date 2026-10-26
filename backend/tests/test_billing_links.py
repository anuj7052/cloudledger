import pytest

from routers import billing as customer_routes, billing_ledger as ledger_routes, billing_links as routes, billing_services as services
from services.billing_links import similarity
from tests.test_billing_ledger import db  # noqa: F401

ADMIN = {'account_id': 1, 'user_id': 'one', 'actor_id': 1, 'can_administer': True, 'name': 'Anuj'}


def test_fuzzy_ignores_company_suffixes():
    assert similarity('Zricks-Prod', 'Zricks.com Pvt Ltd') >= 0.6
    assert similarity('AVIS India Mobility - Azure Plan', 'AVIS INDIA MOBILITY SOLUTIONS') >= 0.8
    assert similarity('Contoso Dev', 'Ebix Cash Ltd.') < 0.6


@pytest.mark.asyncio
async def test_auto_map_writes_po_notes_and_manual_fix(db):  # noqa: F811
    zr = await customer_routes.create_customer(customer_routes.CustomerInput(name='Zricks.com Pvt Ltd'), ADMIN, db)
    eb = await customer_routes.create_customer(customer_routes.CustomerInput(name='Ebix Cash Ltd.'), ADMIN, db)
    wz = await ledger_routes.create_workload(zr['id'], ledger_routes.WorkloadInput(name='Azure Plan'), ADMIN, db)
    we = await ledger_routes.create_workload(eb['id'], ledger_routes.WorkloadInput(name='Azure Plan'), ADMIN, db)
    svc = await services.create_service(zr['id'], services.ServiceInput(workload_id=wz['id'], name='VM D4s', po_number='PO-9', boq_ref='BOQ 2', activated_on='2026-06-10', monthly_cost='5000'), ADMIN, db)
    out = await routes.suggest(routes.SuggestInput(tenant_id='t1', subscriptions=[{'id': 's1', 'name': 'Zricks Production'}, {'id': 's2', 'name': 'Random Lab'}]), ADMIN, db)
    first, second = out['items']
    assert first['customer_id'] == zr['id'] and first['workload_id'] == wz['id'] and first['method'] == 'auto'
    assert second['method'] == 'none'
    async with db.execute("SELECT note_date, body, color FROM cost_notes WHERE source='billing' AND subscription_id='s1'") as c:
        notes = await c.fetchall()
    assert len(notes) == 1 and notes[0][0] == '2026-06-10' and 'PO PO-9' in notes[0][1] and 'BOQ 2' in notes[0][1]
    # Wrong match corrected by the owner: notes move with the mapping.
    await routes.save_link(routes.LinkInput(tenant_id='t1', subscription_id='s1', customer_id=eb['id'], workload_id=we['id']), ADMIN, db)
    async with db.execute("SELECT COUNT(*) FROM cost_notes WHERE source='billing'") as c:
        assert (await c.fetchone())[0] == 0
    # Service deleted -> its notes go too
    await routes.save_link(routes.LinkInput(tenant_id='t1', subscription_id='s1', customer_id=zr['id'], workload_id=wz['id']), ADMIN, db)
    await services.delete_service(svc['id'], ADMIN, db)
    async with db.execute("SELECT COUNT(*) FROM cost_notes WHERE source='billing'") as c:
        assert (await c.fetchone())[0] == 0
