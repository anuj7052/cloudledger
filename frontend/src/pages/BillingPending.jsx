import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Mail, Send, X } from 'lucide-react';
import { approvePendingMail, fetchPendingBills, fetchReminderHistory, previewPendingMail } from '../api/client';
import { errorMessage } from '../utils/apiError';
import { useCanAdminister } from '../hooks/useCanAdminister';
import { BillingPage } from '../components/billing-ui/workspace';

/* Pending amounts by customer and month; reminder mails go only after an admin approves. */
const fmt = v => `INR ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' }); };
const when = v => (v ? new Date(String(v).replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function BillingPending() {
  const admin = useCanAdminister();
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [open, setOpen] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([fetchPendingBills(), fetchReminderHistory()]).then(([p, h]) => { setData(p); setHistory(h.items || []); }).catch(e => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, []);
  const showPreview = async c => { try { setPreview({ ...(await previewPendingMail(c.customer_id)), customer: c }); } catch (e) { toast.error(errorMessage(e)); } };
  const approve = async () => {
    setBusy(true);
    try { const r = await approvePendingMail(preview.customer.customer_id); toast.success(`Mail sent to ${r.to}`); setPreview(null); load(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (!data) return <BillingPage title="Pending bills"><p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />Loading…</p></BillingPage>;
  return (
    <BillingPage title="Pending bills" description="Unpaid amounts by customer and month. Reminder mails are sent only when you approve them.">
      {data.test_mode && <p className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800"><b>Test mode:</b> every reminder goes to <b>{data.test_to}</b>, not to the customer. The subject shows which customer address it would go to.</p>}
      {!data.mail_ready && <p className="rounded-xl border border-red-400 px-4 py-3 text-sm text-red-500">Mail is not configured on the server.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Total pending', fmt(data.total_due)], ['Customers with dues', data.items.length], ['Pending invoices', data.items.reduce((t, c) => t + c.invoices, 0)]].map(([k, v]) => <div key={k} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">{k}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{v}</p></div>)}
      </div>
      <div className="space-y-3">
        {data.items.map(c => (
          <section key={c.customer_id} className="rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => setOpen(open === c.customer_id ? '' : c.customer_id)} className="min-w-0 text-left">
                <p className="font-semibold text-slate-100">{c.customer}</p>
                <p className="text-xs text-slate-500">{c.months.length} month{c.months.length === 1 ? '' : 's'} · {c.invoices} invoice{c.invoices === 1 ? '' : 's'} · {c.email || 'no customer email'}{c.last_reminder ? ` · last reminder ${when(c.last_reminder)}` : ''}</p>
              </button>
              <div className="flex items-center gap-3"><span className="text-lg font-semibold tabular-nums text-amber-600">{fmt(c.total_due)}</span>{admin && <button type="button" disabled={!data.mail_ready} onClick={() => showPreview(c)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ea580c] px-3 py-2 text-sm font-semibold text-[#ffffff] disabled:opacity-50"><Mail size={15} />Review mail</button>}</div>
            </div>
            {open === c.customer_id && (
              <div className="overflow-x-auto border-t border-slate-800"><table className="w-full min-w-[40rem] text-sm">
                <thead><tr className="text-left text-xs text-slate-500">{['Month', 'Invoices', 'Billed', 'Received', 'Pending'].map(h => <th key={h} className={`px-4 py-2 font-medium ${['Billed', 'Received', 'Pending'].includes(h) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{c.months.map(m => <tr key={m.period} className="border-t border-slate-800/60"><td className="px-4 py-2">{monthName(m.period)}</td><td className="px-4 py-2 text-xs text-slate-400">{m.invoices.map(i => `${i.invoice_number || '—'} (${i.subscription})`).join(', ')}</td><td className="px-4 py-2 text-right tabular-nums">{fmt(m.billed)}</td><td className="px-4 py-2 text-right tabular-nums">{fmt(m.received)}</td><td className="px-4 py-2 text-right font-semibold tabular-nums text-amber-600">{fmt(m.due)}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        ))}
        {!data.items.length && <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nothing pending. 🎉</p>}
      </div>
      {history.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900"><h3 className="border-b border-slate-800 px-4 py-3 font-semibold">Reminders sent</h3><ul className="divide-y divide-slate-800 text-sm">{history.map(h => <li key={h.id} className="flex flex-wrap justify-between gap-2 px-4 py-2"><span>{h.customer} → {h.sent_to}</span><span className="text-xs text-slate-500">{fmt(h.total_due)} · {h.status} · {h.approved_by || ''} · {when(h.created_at)}</span></li>)}</ul></section>}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onMouseDown={e => e.target === e.currentTarget && setPreview(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-3xl rounded-2xl bg-[#ffffff] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-[#111827]">Approve payment reminder</h2><p className="mt-1 text-sm text-[#4b5563]">To: <b>{preview.to}</b>{preview.test_mode && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">test — customer email: {preview.customer_email || 'not set'}</span>}</p><p className="text-sm text-[#4b5563]">Subject: {preview.subject}</p></div><button type="button" aria-label="Close" onClick={() => setPreview(null)} className="rounded p-1 text-[#6b7280]"><X size={18} /></button></div>
            <iframe title="Mail preview" sandbox="" srcDoc={preview.html} className="mt-4 h-96 w-full rounded-lg border border-[#e5e7eb]" />
            <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-[#d1d5db] px-4 py-2 text-sm text-[#374151]">Cancel</button><button type="button" disabled={busy} onClick={approve} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ea580c] px-4 py-2 text-sm font-semibold text-[#ffffff] disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Approve &amp; send</button></div>
          </div>
        </div>
      )}
    </BillingPage>
  );
}
