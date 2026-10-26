import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Link2, Loader2, Sparkles, Unlink } from 'lucide-react';
import * as api from '../../api/client';
import { errorMessage } from '../../utils/apiError';
import { useAppStore } from '../../store/useAppStore';
import { tenantText } from '../../utils/identity';

/*
 * Maps each Azure subscription in the signed-in tenant to a billing customer
 * (and billing subscription). Strong fuzzy matches are linked automatically;
 * the owner corrects anything wrong. Once linked, every PO/BOQ service on that
 * billing subscription appears as a highlighted note on the cost dashboard.
 */
const sel = 'h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200';

export default function AzureLinks({ canEdit }) {
  const tenantId = useAppStore(s => s.selectedTenantId);
  const tenants = useAppStore(s => s.tenants);
  const setSelectedTenant = useAppStore(s => s.setSelectedTenant);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const load = async () => {
    setError('');
    try {
      const subs = await api.fetchSubscriptions(tenantId);
      const result = await api.suggestBillingAzureLinks({ tenant_id: tenantId, subscriptions: subs.map(s => ({ id: s.subscription_id, name: s.display_name || '' })) });
      setData(result); setDraft({});
      if (result.auto_linked) toast.success(`${result.auto_linked} subscription${result.auto_linked > 1 ? 's' : ''} matched automatically. Check them below.`);
    } catch (e) { setError(errorMessage(e)); setData({ items: [], customers: [], workloads: [] }); }
  };
  useEffect(() => { if (tenantId) load(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tenantId && (tenants || []).length) return <label className="block max-w-sm text-sm text-slate-400">Choose the tenant to map<select className={`${sel} mt-1`} value="" onChange={e => setSelectedTenant(e.target.value)}><option value="">Choose…</option>{tenants.map(t => <option key={t.tenant_id} value={t.tenant_id}>{tenantText(t.tenant_name)}</option>)}</select></label>;
  if (!tenantId) return <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Sign in to a tenant (Settings → session token) to map its Azure subscriptions.</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />Reading Azure subscriptions and matching customers…</p>;
  const custName = id => data.customers.find(c => c.id === id)?.name || '';
  const tenantName = tenantText(tenants?.find(t => t.tenant_id === tenantId)?.tenant_name);
  const save = async row => {
    const d = { customer_id: row.customer_id || row.suggested_customer_id, workload_id: row.workload_id, ...draft[row.subscription_id] };
    if (!d.customer_id) { toast.error('Choose a customer'); return; }
    setBusy(row.subscription_id);
    try { await api.saveBillingAzureLink({ tenant_id: tenantId, subscription_id: row.subscription_id, azure_name: row.azure_name, customer_id: d.customer_id, workload_id: d.workload_id || '' }); toast.success('Mapping saved — PO/BOQ notes updated'); await load(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const unlink = async row => {
    setBusy(row.subscription_id);
    try { await api.removeBillingAzureLink(tenantId, row.subscription_id); toast.success('Mapping removed'); await load(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const linked = data.items.filter(r => r.customer_id).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100"><Link2 size={18} className="text-[#ea580c]" />Map Azure subscriptions to customers</h2>
          <p className="mt-1 text-sm text-slate-400">{linked} of {data.items.length} subscriptions in {tenantName} are linked. Matches are made automatically by name; change any that are wrong. Linked subscriptions show each PO/BOQ service as a highlighted note on the cost dashboard.</p>
        </div>
        {(tenants || []).length > 1 && <label className="text-xs text-slate-400">Tenant<select className={`${sel} mt-1 min-w-56`} value={tenantId} onChange={e => { setData(null); setSelectedTenant(e.target.value); }}>{tenants.map(t => <option key={t.tenant_id} value={t.tenant_id}>{tenantText(t.tenant_name)}</option>)}</select></label>}
        <button type="button" onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-[#ea580c]"><Sparkles size={14} className="mr-1 inline" />Match again</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[56rem] text-sm">
          <thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500">{['Azure subscription', 'Match', 'Customer', 'Billing subscription', ''].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{data.items.map(row => {
            const d = { customer_id: row.customer_id || row.suggested_customer_id, workload_id: row.customer_id ? row.workload_id : row.suggested_workload_id, ...draft[row.subscription_id] };
            const changed = d.customer_id !== row.customer_id || (d.workload_id || '') !== (row.workload_id || '');
            const pct = Math.round((row.score || 0) * 100);
            return (
              <tr key={row.subscription_id} className="border-b border-slate-800/60 last:border-0 align-top">
                <td className="px-4 py-3"><p className="font-medium text-slate-100">{row.azure_name || 'Unnamed subscription'}</p><p className="text-[11px] text-slate-500">{row.subscription_id}</p></td>
                <td className="px-4 py-3">{row.method === 'manual' ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500"><CheckCircle2 size={12} />Confirmed</span> : row.method === 'auto' ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">Auto · {pct}%</span> : <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-xs text-slate-400">{pct >= 30 ? `Suggest · ${pct}%` : 'Not linked'}</span>}</td>
                <td className="px-4 py-3"><select disabled={!canEdit} aria-label="Customer" className={sel} value={d.customer_id || ''} onChange={e => setDraft(x => ({ ...x, [row.subscription_id]: { customer_id: e.target.value, workload_id: data.workloads.filter(w => w.customer_id === e.target.value).length === 1 ? data.workloads.find(w => w.customer_id === e.target.value).id : '' } }))}><option value="">— Not linked —</option>{data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td className="px-4 py-3"><select disabled={!canEdit || !d.customer_id} aria-label="Billing subscription" className={sel} value={d.workload_id || ''} onChange={e => setDraft(x => ({ ...x, [row.subscription_id]: { ...d, workload_id: e.target.value } }))}><option value="">Whole customer</option>{data.workloads.filter(w => w.customer_id === d.customer_id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{canEdit && <>
                  <button type="button" disabled={busy === row.subscription_id || !d.customer_id || (!changed && row.method === 'manual')} onClick={() => save({ ...row, ...d, customer_id: d.customer_id })} className="rounded-lg bg-[#ea580c] px-3 py-1.5 text-xs font-semibold text-[#ffffff] disabled:opacity-40">{busy === row.subscription_id ? <Loader2 size={12} className="animate-spin" /> : row.method === 'manual' && !changed ? 'Saved' : row.customer_id && !changed ? 'Confirm' : 'Assign'}</button>
                  {row.customer_id && <button type="button" aria-label="Unlink" title="Unlink" onClick={() => unlink(row)} className="ml-1 rounded p-1.5 text-slate-500 hover:text-red-400"><Unlink size={14} /></button>}
                </>}{!canEdit && custName(row.customer_id)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

/** Small panel on a customer page: which Azure subscriptions are linked to this customer. */
export function CustomerAzureLinks({ customerId }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    api.listCustomerAzureLinks(customerId).then(d => { if (live) setItems(d.items || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [customerId]);
  if (items == null) return null;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Link2 size={15} className="text-[#ea580c]" />Linked Azure subscriptions ({items.length})</h2>
        <a href="/azure-billing/mapping" className="text-xs font-medium text-[#c2410c] hover:underline">{items.length ? 'Change mapping' : 'Map Azure subscriptions'} →</a>
      </div>
      {!items.length ? <p className="mt-2 text-xs text-slate-500">No Azure subscription is linked to this customer yet. Open the mapping to link one; PO/BOQ notes then appear on the cost dashboard.</p> : (
        <ul className="mt-3 flex flex-wrap gap-2">{items.map(l => <li key={l.tenant_id + l.subscription_id} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs"><span className="font-medium text-slate-200">{l.azure_name || 'Unnamed subscription'}</span>{l.workload && <span className="text-slate-500"> → {l.workload}</span>}<span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${l.method === 'manual' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-600'}`}>{l.method === 'manual' ? 'Confirmed' : 'Auto'}</span></li>)}</ul>
      )}
    </section>
  );
}
