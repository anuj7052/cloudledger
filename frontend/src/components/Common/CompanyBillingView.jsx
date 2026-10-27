import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2 } from 'lucide-react';
import * as api from '../../api/client';

/*
 * Everything for one company in the selected period: month-by-month billing,
 * distributor cost, profit, payment received and balance, each subscription,
 * extra charges, and the POs / BOQs behind the services.
 */
const num = v => (v == null || v === '' ? null : Number(v));
const fmt = (v, c = 'INR') => (v == null ? '—' : `${c} ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const monthName = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' }); };
const day = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const card = 'rounded-xl border border-slate-800 bg-slate-900';

export default function CompanyBillingView({ customerId, from, to }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([api.getBillingLedger(customerId), api.listBillingExtraCharges(customerId).catch(() => ({ items: [] })), api.listBillingServices(customerId).catch(() => ({ items: [] })), api.listCombinedBills(customerId).catch(() => ({ items: [] }))])
      .then(([ledger, extras, services, bills]) => { if (live) setData({ ledger, services: services.items || [], extras: [...(extras.items || []), ...(bills.items || []).flatMap(b => b.lines.map((l, i) => ({ id: `${b.id}-${i}`, period: b.period, charge_type: `Tenant bill · ${l.type}`, description: '', invoice_number: l.invoice_number || b.invoice_number, amount: l.amount, distributor_amount: l.distributor_amount, distributor: l.distributor || b.distributor, currency: b.currency, received_amount: i === 0 ? b.received_amount : null, payment_status: i === 0 ? b.payment_status : '' })))] }); })
      .catch(() => { if (live) setData({ ledger: { entries: [], workloads: [] }, extras: [], services: [] }); });
    return () => { live = false; };
  }, [customerId]);

  const view = useMemo(() => {
    if (!data) return null;
    const first = from.slice(0, 7), last = to.slice(0, 7);
    const inRange = p => p >= first && p <= last;
    const entries = (data.ledger.entries || []).filter(e => !e.archived && !e.workload_archived && inRange(e.period));
    const extras = data.extras.filter(x => inRange(x.period));
    const months = {};
    const add = (p, k, v) => { if (v == null) return; const m = (months[p] ||= { period: p, billed: 0, cost: 0, received: 0, extra: 0, count: 0 }); m[k] += v; };
    for (const e of entries) { add(e.period, 'billed', num(e.customer_amount)); add(e.period, 'cost', num(e.distributor_amount)); add(e.period, 'received', num(e.received_amount)); (months[e.period] ||= { period: e.period, billed: 0, cost: 0, received: 0, extra: 0, count: 0 }).count += 1; }
    for (const x of extras) { add(x.period, 'billed', num(x.amount)); if (!x.charge_type.startsWith('Tenant bill')) add(x.period, 'extra', num(x.amount)); add(x.period, 'cost', num(x.distributor_amount)); add(x.period, 'received', num(x.received_amount)); }
    const rows = Object.values(months).sort((a, b) => b.period.localeCompare(a.period));
    const total = rows.reduce((t, m) => ({ billed: t.billed + m.billed, cost: t.cost + m.cost, received: t.received + m.received, extra: t.extra + m.extra }), { billed: 0, cost: 0, received: 0, extra: 0 });
    const subs = (data.ledger.workloads || []).filter(w => !w.archived).map(w => {
      const es = entries.filter(e => e.workload_id === w.id);
      return { ...w, billed: es.reduce((t, e) => t + (num(e.customer_amount) || 0), 0), cost: es.reduce((t, e) => t + (num(e.distributor_amount) || 0), 0), months: es.length };
    });
    return { rows, total, subs, extras, entries };
  }, [data, from, to]);

  if (!view) return <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />Loading company details…</p>;
  const { rows, total, subs, extras, entries } = view;
  const due = total.billed - total.received;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[['Billed', total.billed], ['Distributor cost', total.cost || null], ['Profit / loss', total.cost ? total.billed - total.cost : null], ['Received', total.received], ['Balance due', due]].map(([k, v]) => (
          <div key={k} className={`${card} p-4`}><p className="text-xs text-slate-500">{k}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${k === 'Profit / loss' && v != null ? (v >= 0 ? 'text-emerald-500' : 'text-rose-400') : k === 'Balance due' && v > 0.005 ? 'text-amber-500' : 'text-slate-100'}`}>{fmt(v)}</p></div>
        ))}
      </div>

      <section className={card}>
        <h3 className="border-b border-slate-800 px-5 py-3 font-semibold text-slate-100">Month by month <span className="text-xs font-normal text-slate-500">· profit shows once the distributor amount is entered</span></h3>
        {!rows.length ? <p className="p-5 text-sm text-slate-400">No billing in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500">{['Month', 'Billed', 'of which extra', 'Distributor', 'Profit / loss', 'Received', 'Balance due'].map(h => <th key={h} className={`px-4 py-2.5 font-medium ${h === 'Month' ? '' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(m => (
              <tr key={m.period} className="border-b border-slate-800/60 last:border-0">
                <td className="px-4 py-2.5 text-slate-200">{monthName(m.period)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(m.billed)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{m.extra ? fmt(m.extra) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{m.cost ? fmt(m.cost) : '—'}</td>
                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${!m.cost ? 'text-slate-500' : m.billed - m.cost >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>{m.cost ? fmt(m.billed - m.cost) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{m.received ? fmt(m.received) : '—'}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${m.billed - m.received > 0.005 ? 'text-amber-500' : 'text-emerald-500'}`}>{fmt(m.billed - m.received)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={card}>
          <h3 className="border-b border-slate-800 px-5 py-3 font-semibold text-slate-100">Subscriptions ({subs.length})</h3>
          <ul className="divide-y divide-slate-800">{subs.map(w => (
            <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium text-slate-200">{w.name}</p><p className="text-xs text-slate-500">{w.months} month{w.months === 1 ? '' : 's'} in period{w.owner ? ` · ${w.owner}` : ''}</p></div><div className="text-right tabular-nums"><p>{fmt(w.billed)}</p>{w.cost > 0 && <p className="text-xs text-slate-500">cost {fmt(w.cost)}</p>}</div></li>
          ))}{!subs.length && <li className="px-5 py-4 text-sm text-slate-400">No subscriptions.</li>}</ul>
        </section>
        <section className={card}>
          <h3 className="border-b border-slate-800 px-5 py-3 font-semibold text-slate-100">POs, BOQs & services ({data.services.length})</h3>
          <ul className="divide-y divide-slate-800">{data.services.map(sv => (
            <li key={sv.id} className="px-5 py-3 text-sm"><p className="font-medium text-slate-200">{sv.name} <span className="text-xs font-normal text-slate-500">· {sv.status}</span></p><p className="text-xs text-slate-400">{sv.po_number ? `PO ${sv.po_number} (${day(sv.po_date)})` : 'No PO'}{sv.boq_ref ? ` · BOQ ${sv.boq_ref}` : ''} · activated {day(sv.activated_on)} · <FileText size={11} className="inline" /> {sv.files.length} doc{sv.files.length === 1 ? '' : 's'}</p></li>
          ))}{!data.services.length && <li className="px-5 py-4 text-sm text-slate-400">No PO / BOQ recorded yet.</li>}</ul>
        </section>
      </div>

      <section className={card}>
        <h3 className="border-b border-slate-800 px-5 py-3 font-semibold text-slate-100">Invoices & payments in this period ({entries.length + extras.length})</h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[56rem] text-sm">
          <thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500">{['Month', 'Subscription / charge', 'Invoice', 'Billed', 'Distributor', 'Received', 'Payment remark'].map(h => <th key={h} className={`px-4 py-2.5 font-medium ${['Billed', 'Received'].includes(h) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {[...entries.map(e => ({ ...e, _k: e.id, label: `${e.workload}${e.billing_type && e.billing_type !== 'Azure usage' ? ` · ${e.billing_type}` : ''}`, billed: e.customer_amount })), ...extras.map(x => ({ ...x, _k: `x${x.id}`, label: `${x.charge_type.startsWith('Tenant bill') ? '' : 'Extra · '}${x.charge_type}${x.description ? ` · ${x.description}` : ''}`, billed: x.amount }))]
              .sort((a, b) => b.period.localeCompare(a.period)).map(r => (
                <tr key={r._k} className="border-b border-slate-800/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">{monthName(r.period)}</td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-slate-200" title={r.label}>{r.label}</td>
                  <td className="px-4 py-2.5 text-slate-400">{r.invoice_number || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{fmt(num(r.billed), r.currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{r.distributor ? `${r.distributor}${r.distributor_amount != null ? ` · ${fmt(num(r.distributor_amount), r.currency)}` : ''}` : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{r.received_amount != null ? fmt(num(r.received_amount), r.currency) : '—'}</td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-xs text-slate-400" title={r.payment_status}>{r.payment_status || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
      </section>
      <Link to={`/azure-billing?customer=${encodeURIComponent(customerId)}`} className="inline-block text-sm font-medium text-[#c2410c] hover:underline">Open full customer page →</Link>
    </div>
  );
}
