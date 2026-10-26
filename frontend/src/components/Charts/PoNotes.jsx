import { useEffect, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { listCostNotes } from '../../api/client';

/*
 * Highlighted "why did cost change" notes: services activated or stopped under
 * a PO/BOQ (written automatically from Azure Billing), and team notes the owner
 * has linked to a PO.
 */
export default function PoNotes({ tenantId, subscriptionIds, from, to, names = {} }) {
  const [notes, setNotes] = useState([]);
  const key = subscriptionIds.join(',');
  useEffect(() => {
    if (!tenantId || !from || !to) return undefined;
    let live = true;
    listCostNotes({ tenant_id: tenantId, from_date: from, to_date: to, subscription_ids: subscriptionIds })
      .then(list => { if (live) setNotes((list || []).filter(n => n.source === 'billing' || n.linked_service)); })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [tenantId, from, to, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!notes.length) return null;
  const day = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section className="rounded-2xl border-2 border-[#fdba74] bg-[#fff7ed] p-5" aria-labelledby="po-notes-title">
      <h2 id="po-notes-title" className="flex items-center gap-2 text-base font-semibold text-[#9a3412]"><FileCheck2 className="h-5 w-5" />Why cost changed — PO &amp; BOQ activity</h2>
      <p className="mt-1 text-xs text-[#9a3412]/80">Services activated or stopped in this period, from Azure Billing POs and BOQs.</p>
      <ol className="mt-4 space-y-2">
        {[...notes].sort((a, b) => b.note_date.localeCompare(a.note_date)).map(n => (
          <li key={n.id} className="flex flex-wrap items-start gap-3 rounded-xl border-l-4 border-[#ea580c] bg-[#ffffff] px-4 py-3 shadow-sm">
            <span className="w-24 shrink-0 text-xs font-semibold text-[#c2410c]">{day(n.note_date)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[#431407]">{n.body}</p>
              {n.linked_service && <p className="mt-1 text-xs font-medium text-[#c2410c]">Linked: {n.linked_service.name}{n.linked_service.po_number ? ` · PO ${n.linked_service.po_number}` : ''}{n.linked_service.boq_ref ? ` · BOQ ${n.linked_service.boq_ref}` : ''}</p>}
              <p className="mt-0.5 text-[11px] text-[#9a3412]/70">{n.subscription_id ? names[n.subscription_id] || 'Unnamed subscription' : 'Whole tenant'}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
