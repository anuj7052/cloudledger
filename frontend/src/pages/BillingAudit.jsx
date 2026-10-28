import { Fragment, useEffect, useState } from 'react';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { exportBillingAudit, fetchBillingAudit, listBillingCustomers } from '../api/client';
import { errorMessage } from '../utils/apiError';
import { BillingPage } from '../components/billing-ui/workspace';

/* Who changed what in Azure Billing, when, and why. Read-only. */
const ACTIONS = { create: 'Created', update: 'Edited', delete: 'Deleted', archive: 'Archived', restore: 'Restored', map: 'Mapped', import: 'Imported' };
const ctl = 'h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]';
const when = v => new Date(String(v).replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const label = f => f.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const tone = { create: 'bg-emerald-500/10 text-emerald-600', update: 'bg-blue-500/10 text-blue-500', delete: 'bg-rose-500/10 text-rose-500', archive: 'bg-amber-500/10 text-amber-600', restore: 'bg-emerald-500/10 text-emerald-600' };

export default function BillingAudit() {
  const [filters, setFilters] = useState(() => ({ from_date: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to_date: new Date().toISOString().slice(0, 10), user_filter: '', kind: '', action: '', customer_id: '', q: '' }));
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const key = JSON.stringify(filters);
  useEffect(() => { listBillingCustomers().then(d => setCustomers(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetchBillingAudit(JSON.parse(key)).then(d => { if (live) { setData(d); setError(''); } }).catch(e => { if (live) setError(errorMessage(e)); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const set = p => setFilters(f => ({ ...f, ...p }));
  const download = async () => {
    const blob = await exportBillingAudit(filters);
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `billing-audit-${filters.from_date}-to-${filters.to_date}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <BillingPage title="Audit log" description="Every change in Azure Billing: who, what, when and why. Records cannot be edited or deleted."
      actions={<button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ea580c] px-3 py-2 text-sm font-semibold text-[#ffffff]"><Download size={15} />Export audit report</button>}>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <label className="text-xs text-slate-400">From<input type="date" className={`${ctl} mt-1 block`} value={filters.from_date} onChange={e => set({ from_date: e.target.value })} /></label>
        <label className="text-xs text-slate-400">To<input type="date" className={`${ctl} mt-1 block`} value={filters.to_date} onChange={e => set({ to_date: e.target.value })} /></label>
        <label className="text-xs text-slate-400">Customer<select className={`${ctl} mt-1 block max-w-56`} value={filters.customer_id} onChange={e => set({ customer_id: e.target.value })}><option value="">All</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-xs text-slate-400">Type<select className={`${ctl} mt-1 block`} value={filters.kind} onChange={e => set({ kind: e.target.value })}><option value="">All</option>{Object.entries(data?.types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-slate-400">Action<select className={`${ctl} mt-1 block`} value={filters.action} onChange={e => set({ action: e.target.value })}><option value="">All</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-slate-400">User<input className={`${ctl} mt-1 block`} value={filters.user_filter} onChange={e => set({ user_filter: e.target.value })} placeholder="name or email" /></label>
        <label className="text-xs text-slate-400">Search<input className={`${ctl} mt-1 block`} value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="invoice, reason…" /></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!data ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />Loading…</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <p className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-500"><ShieldCheck size={13} />{data.items.length} change{data.items.length === 1 ? '' : 's'}{data.items.length >= 500 ? ' (latest 500 — export for all)' : ''}</p>
          <table className="w-full min-w-[64rem] text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500">{['When', 'User', 'Action', 'Item', 'What changed', 'Reason'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{data.items.map(r => (
              <Fragment key={r.id}>
                <tr onClick={() => setOpen(open === r.id ? '' : r.id)} className="cursor-pointer border-b border-slate-800/60 align-top hover:bg-slate-800/30">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">{when(r.at)}</td>
                  <td className="px-4 py-2.5"><p className="text-slate-200">{r.user}</p>{r.email && r.email !== r.user && <p className="text-[11px] text-slate-500">{r.email}</p>}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[r.action] || 'bg-slate-700/40 text-slate-300'}`}>{ACTIONS[r.action] || r.action}</span><p className="mt-1 text-[11px] text-slate-500">{r.type}</p></td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-slate-200">{r.item}</td>
                  <td className="px-4 py-2.5 text-xs">{r.changes.length ? r.changes.slice(0, 4).map(c => <p key={c.field}><span className="text-slate-500">{label(c.field)}:</span> <span className="text-rose-400 line-through">{c.old || '—'}</span> → <span className="text-emerald-500">{c.new || '—'}</span></p>) : <span className="text-slate-500">—</span>}{r.changes.length > 4 && <p className="text-slate-500">+{r.changes.length - 4} more</p>}</td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-xs">{r.reason ? <span className="text-slate-200">{r.reason}</span> : <span className="text-slate-500">not recorded</span>}</td>
                </tr>
                {open === r.id && <tr key={`${r.id}-d`} className="border-b border-slate-800/60 bg-slate-950/40"><td colSpan={6} className="px-4 py-3"><div className="grid gap-3 text-xs md:grid-cols-2"><div><p className="mb-1 font-semibold text-slate-400">Before</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-slate-300">{JSON.stringify(r.before, null, 2)}</pre></div><div><p className="mb-1 font-semibold text-slate-400">After</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-slate-300">{JSON.stringify(r.after, null, 2)}</pre></div></div></td></tr>}
              </Fragment>
            ))}{!data.items.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No changes match these filters.</td></tr>}</tbody>
          </table>
        </div>
      )}
    </BillingPage>
  );
}
