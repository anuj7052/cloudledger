import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { createCombinedBill, updateCombinedBill } from '../../api/client';
import { errorMessage } from '../../utils/apiError';

/*
 * One invoice for the whole customer / tenant. Enter it by charge type
 * (pay-as-you-go, monthly RI, one-time RI…), then optionally split each
 * amount across subscriptions. Saved on its own; existing subscription
 * entries are never touched.
 */
const TYPES = ['Pay-as-you-go', 'Monthly RI', 'One-time RI', 'Savings plan', 'Licence / subscription', 'Marketplace', 'Other'];
const box = 'h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]';
const money = v => `INR ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = v => Math.round(v * 100) / 100;
const blankLine = type => ({ type, amount: '', distributor_amount: '', invoice_number: '', distributor: '', distributor_invoice: '', split: {} });

export default function CombinedBillForm({ customerId, subscriptions, distributors, existing, period: initialPeriod, onSaved, onCancel, monthHasEntries }) {
  const [f, setF] = useState(() => existing ? {
    ...existing, received_amount: existing.received_amount ?? '',
    lines: existing.lines.map(l => ({ invoice_number: '', distributor: '', distributor_invoice: '', ...l, distributor_amount: l.distributor_amount ?? '', split: Object.fromEntries(Object.entries(l.split || {}).map(([k, v]) => [k, String(v)])) })),
  } : { period: initialPeriod, invoice_number: '', distributor: '', distributor_invoice: '', amount_basis: 'gross', received_amount: '', payment_status: '', lines: ['Pay-as-you-go', 'Monthly RI', 'One-time RI'].map(blankLine) });
  const [busy, setBusy] = useState(false);
  const set = p => setF(x => ({ ...x, ...p }));
  const setLine = (i, p) => setF(x => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
  const setSplit = (i, wid, v) => setLine(i, { split: { ...f.lines[i].split, [wid]: v } });
  const splitTotal = l => Object.values(l.split).reduce((t, v) => t + (Number(v) || 0), 0);
  const equal = i => { const l = f.lines[i]; const n = subscriptions.length; if (!n || !l.amount) return; const each = r2(Number(l.amount) / n); setLine(i, { split: Object.fromEntries(subscriptions.map((w, k) => [w.id, String(k === n - 1 ? r2(Number(l.amount) - each * (n - 1)) : each)])) }); };
  const used = f.lines.filter(l => l.amount !== '');
  const total = used.reduce((t, l) => t + Number(l.amount), 0);
  const cost = used.reduce((t, l) => t + (Number(l.distributor_amount) || 0), 0);
  const bad = used.find(l => splitTotal(l) > 0 && Math.abs(splitTotal(l) - Number(l.amount)) > 0.01);
  const save = async () => {
    if (!used.length) { toast.error('Enter at least one amount'); return; }
    if (bad) { toast.error(`${bad.type}: the split must add up to ${money(bad.amount)}`); return; }
    setBusy(true);
    try {
      const body = {
        period: f.period, invoice_number: f.invoice_number.trim(), distributor: f.distributor.trim(), distributor_invoice: f.distributor_invoice.trim(), amount_basis: f.amount_basis,
        received_amount: f.received_amount === '' ? null : f.received_amount, payment_status: f.payment_status.trim(),
        lines: used.map(l => ({ type: l.type, amount: l.amount, invoice_number: (l.invoice_number || '').trim(), distributor: (l.distributor || '').trim(), distributor_invoice: (l.distributor_invoice || '').trim(), distributor_amount: l.distributor_amount === '' ? null : l.distributor_amount, split: splitTotal(l) > 0 ? Object.fromEntries(Object.entries(l.split).filter(([, v]) => Number(v) > 0)) : {} })),
      };
      const saved = existing ? await updateCombinedBill(existing.id, body) : await createCombinedBill(customerId, body);
      toast.success(existing ? 'Tenant bill updated' : 'Tenant bill saved');
      onSaved(saved);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-[#fff7ed] px-3 py-2 text-xs text-[#9a3412]">One invoice for the whole tenant. Enter each charge type, then split it across subscriptions if you want. Existing subscription entries are not changed.</p>
      {monthHasEntries && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">This month already has subscription entries for this customer. If they are the same bill, it will be counted twice.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">Month<input type="month" className={`${box} mt-1`} value={f.period} onChange={e => set({ period: e.target.value })} /></label>
        <label className="text-xs text-slate-400">Invoice number<input className={`${box} mt-1`} value={f.invoice_number} onChange={e => set({ invoice_number: e.target.value })} placeholder="e.g. ID26FCS0900" /></label>
        <label className="text-xs text-slate-400">Distributor<input list="cb-dist" className={`${box} mt-1`} value={f.distributor} onChange={e => set({ distributor: e.target.value })} placeholder="e.g. Redington" /><datalist id="cb-dist">{distributors.map(d => <option key={d} value={d} />)}</datalist></label>
        <label className="text-xs text-slate-400">Distributor invoice<input className={`${box} mt-1`} value={f.distributor_invoice} onChange={e => set({ distributor_invoice: e.target.value })} /></label>
      </div>
      {f.lines.map((l, i) => (
        <div key={i} className="rounded-lg border border-slate-800 p-3">
          <div className="flex items-center gap-2">
            <select aria-label="Charge type" value={l.type} onChange={e => setLine(i, { type: e.target.value })} className={`${box} w-auto font-semibold`}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
            <button type="button" aria-label="Remove line" onClick={() => setF(x => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))} className="ml-auto rounded p-1 text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-500">Our billing<input type="number" min="0" step="0.01" className={box} value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} placeholder="0.00" /></label>
            <label className="text-[11px] text-slate-500">Distributor amount<input type="number" min="0" step="0.01" className={box} value={l.distributor_amount} onChange={e => setLine(i, { distributor_amount: e.target.value })} placeholder="0.00" /></label>
            <label className="text-[11px] text-slate-500">Invoice number <span className="text-slate-600">(optional)</span><input className={box} value={l.invoice_number} onChange={e => setLine(i, { invoice_number: e.target.value })} placeholder={f.invoice_number || 'Same as bill'} /></label>
            <label className="text-[11px] text-slate-500">Distributor <span className="text-slate-600">(optional)</span><input list="cb-dist" className={box} value={l.distributor} onChange={e => setLine(i, { distributor: e.target.value })} placeholder={f.distributor || 'Same as bill'} /></label>
            <label className="col-span-2 text-[11px] text-slate-500">Distributor invoice <span className="text-slate-600">(optional)</span><input className={box} value={l.distributor_invoice} onChange={e => setLine(i, { distributor_invoice: e.target.value })} placeholder={f.distributor_invoice || 'Same as bill'} /></label>
          </div>
          {l.amount !== '' && subscriptions.length > 0 && (
            <details className="mt-2" open={splitTotal(l) > 0}>
              <summary className="cursor-pointer text-xs font-medium text-[#c2410c]">Split by subscription (optional)</summary>
              <div className="mt-2 space-y-1.5">
                {subscriptions.map(w => <label key={w.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-xs text-slate-300"><span className="truncate" title={w.name}>{w.name}</span><input type="number" min="0" step="0.01" className={box} value={l.split[w.id] ?? ''} onChange={e => setSplit(i, w.id, e.target.value)} placeholder="0.00" /></label>)}
                <div className="flex items-center justify-between text-[11px]">
                  <button type="button" onClick={() => equal(i)} className="text-[#c2410c] hover:underline">Split equally</button>
                  <span className={Math.abs(splitTotal(l) - Number(l.amount)) > 0.01 && splitTotal(l) > 0 ? 'text-rose-400' : 'text-slate-500'}>Split {money(splitTotal(l))} of {money(l.amount)}</span>
                </div>
              </div>
            </details>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setF(x => ({ ...x, lines: [...x.lines, blankLine('Other')] }))} className="inline-flex items-center gap-1 text-xs font-medium text-[#c2410c]"><Plus size={12} />Add charge type</button>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">Amount received<input type="number" min="0" step="0.01" className={`${box} mt-1`} value={f.received_amount} onChange={e => set({ received_amount: e.target.value })} placeholder="0.00" /></label>
        <label className="text-xs text-slate-400">Amounts are<select className={`${box} mt-1`} value={f.amount_basis} onChange={e => set({ amount_basis: e.target.value })}><option value="gross">tax included</option><option value="net">before tax</option></select></label>
      </div>
      <label className="block text-xs text-slate-400">Payment remark<input className={`${box} mt-1`} value={f.payment_status} onChange={e => set({ payment_status: e.target.value })} placeholder="e.g. Paid PAYG, RI pending" /></label>
      <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-xs"><span className="text-slate-400">Total {money(total)} · distributor {money(cost)}</span><span className={`font-semibold ${total - cost >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>Profit {cost ? money(total - cost) : '—'}</span></div>
      <div className="flex gap-2">{onCancel && <button type="button" onClick={onCancel} className="flex-1 rounded-md border border-slate-700 py-2 text-sm text-slate-300">Cancel</button>}<button type="button" disabled={busy} onClick={save} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#ea580c] py-2 text-sm font-semibold text-[#ffffff] disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{existing ? 'Update tenant bill' : 'Save tenant bill'}</button></div>
    </div>
  );
}
