"""Azure subscription ↔ billing customer mapping, and automatic PO/BOQ cost notes."""
import re
import uuid
from datetime import date
from difflib import SequenceMatcher

NOISE = {'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'india', 'the', 'co', 'company', 'solutions',
         'subscription', 'azure', 'plan', 'microsoft', 'sub', 'prod', 'production', 'and', 'of'}


def tokens(text):
    words = re.findall(r'[a-z0-9]+', str(text or '').lower())
    kept = [w for w in words if w not in NOISE]
    return kept or words


def similarity(a, b):
    """0..1 fuzzy score (token-sort ratio, boosted when one name's words all appear in the other)."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    ratio = SequenceMatcher(None, ' '.join(sorted(ta)), ' '.join(sorted(tb))).ratio()
    small, big = (set(ta), set(tb)) if len(ta) <= len(tb) else (set(tb), set(ta))
    contained = len(small & big) / len(small)
    return round(max(ratio, contained * 0.95), 3)


def best_match(azure_name, customers, workloads):
    """Pick the billing customer whose name best matches, then the billing subscription
    whose own distinguishing words (e.g. "IT" vs "AI" vs "SAP") match what is left."""
    best = {'customer_id': '', 'workload_id': '', 'score': 0.0}
    for c in customers:
        score = similarity(azure_name, c['name'])
        if score > best['score']:
            best = {'customer_id': c['id'], 'workload_id': '', 'score': score}
    if not best['customer_id']:
        return best
    cust_tokens = set(tokens(next(c['name'] for c in customers if c['id'] == best['customer_id'])))
    own = [w for w in workloads if w['customer_id'] == best['customer_id']]
    rest = [t for t in re.findall(r'[a-z0-9]+', str(azure_name).lower()) if t not in cust_tokens and t not in NOISE]
    if rest and own:
        scored = []
        for w in own:
            wt = [t for t in re.findall(r'[a-z0-9]+', w['name'].lower()) if t not in cust_tokens and t not in NOISE]
            exact = len(set(rest) & set(wt)) / len(set(rest)) if wt else 0
            fuzzy = SequenceMatcher(None, ' '.join(rest), ' '.join(wt)).ratio() if wt else 0
            scored.append((max(exact, fuzzy if fuzzy >= 0.8 else 0), w['id']))
        scored.sort(reverse=True)
        if scored[0][0] >= 0.5 and (len(scored) == 1 or scored[0][0] > scored[1][0]):
            best['workload_id'] = scored[0][1]
    elif len(own) == 1:
        best['workload_id'] = own[0]['id']
    if not best['workload_id'] and len(own) == 1:
        best['workload_id'] = own[0]['id']
    return best


def note_body(service, stopped=False):
    parts = [f"{'Stopped' if stopped else 'Activated' if service['status'] != 'planned' else 'Planned'}: {service['name']}"]
    if service.get('po_number'):
        parts.append(f"PO {service['po_number']}" + (f" ({service['po_date']})" if service.get('po_date') else ''))
    if service.get('boq_ref'):
        parts.append(f"BOQ {service['boq_ref']}")
    if service.get('monthly_cost') and not stopped:
        parts.append(f"~{service.get('currency') or 'INR'} {float(service['monthly_cost']):,.2f}/month")
    if service.get('description'):
        parts.append(service['description'][:300])
    return ' · '.join(parts)[:2000]


async def sync_service_notes(db, owner, service, user):
    """Write/refresh highlighted cost notes for a service on every Azure subscription mapped to its billing subscription."""
    async with db.execute('SELECT tenant_id, subscription_id FROM billing_azure_links WHERE owner_id=? AND workload_id=?', (owner, service['workload_id'])) as cursor:
        links = [tuple(r) for r in await cursor.fetchall()]
    await db.execute('DELETE FROM cost_notes WHERE owner_id=? AND source=? AND service_key LIKE ?', (owner, 'billing', service['id'] + ':%'))
    events = [('start', service.get('activated_on') or service.get('po_date') or date.today().isoformat(), False)]
    if service.get('status') == 'stopped' and service.get('stopped_on'):
        events.append(('stop', service['stopped_on'], True))
    author = str(user.get('name') or user.get('email') or 'Azure Billing')[:200]
    for tenant, sub in links:
        for key, day, stopped in events:
            await db.execute(
                "INSERT INTO cost_notes(id,owner_id,tenant_id,subscription_id,note_date,body,color,author_id,author_name,source,service_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), owner, tenant, sub, day[:10], note_body(service, stopped), 'orange', user.get('actor_id') or 0, author, 'billing', f"{service['id']}:{key}:{sub}"))
    return len(links)


async def remove_service_notes(db, owner, service_id):
    await db.execute('DELETE FROM cost_notes WHERE owner_id=? AND source=? AND service_key LIKE ?', (owner, 'billing', service_id + ':%'))
    await db.execute("UPDATE cost_notes SET linked_service_id='' WHERE owner_id=? AND linked_service_id=?", (owner, service_id))
