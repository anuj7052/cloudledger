import { CalendarClock, FileCheck2, StickyNote } from 'lucide-react';
import { isPoNote, noteColor, todayIso } from '../../utils/costNotes';

/*
 * Highlighted notes for the period on screen: today's notes first, then every
 * note in the period (PO/BOQ ones tagged), so anyone can see why cost moved.
 */
export default function PoNotes({ notes = [], names = {} }) {
  if (!notes.length) return null;
  const today = todayIso();
  const day = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const todays = notes.filter(n => n.note_date === today);
  const rest = notes.filter(n => n.note_date !== today).sort((a, b) => b.note_date.localeCompare(a.note_date));
  const po = notes.filter(isPoNote).length;
  const Item = ({ n }) => {
    const tone = isPoNote(n) ? noteColor('orange') : noteColor(n.color);
    return (
      <li className="flex flex-wrap items-start gap-3 rounded-xl px-4 py-3 shadow-sm" style={{ background: tone.bg, color: tone.text, borderLeft: `4px solid ${tone.dot}` }}>
        <span className="w-24 shrink-0 text-xs font-semibold">{n.note_date === today ? 'Today' : day(n.note_date)}</span>
        <div className="min-w-0 flex-1">
          {isPoNote(n) && <span className="mb-1 mr-2 inline-block rounded-full bg-[#ea580c] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ffffff]">PO / BOQ</span>}
          <p className="inline whitespace-pre-wrap text-sm">{n.body}</p>
          {n.linked_service && <p className="mt-1 text-xs font-semibold">↳ {n.linked_service.name}{n.linked_service.po_number ? ` · PO ${n.linked_service.po_number}` : ''}{n.linked_service.boq_ref ? ` · BOQ ${n.linked_service.boq_ref}` : ''}</p>}
          <p className="mt-0.5 text-[11px] opacity-70">{n.author_name} · {n.subscription_id ? names[n.subscription_id] || 'Unnamed subscription' : 'Whole tenant'}</p>
        </div>
      </li>
    );
  };
  return (
    <section className="rounded-2xl border-2 border-[#fdba74] bg-[#fff7ed] p-5" aria-labelledby="period-notes-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="period-notes-title" className="flex items-center gap-2 text-base font-semibold text-[#9a3412]"><StickyNote className="h-5 w-5" />Notes — why cost changed</h2>
        <p className="text-xs text-[#9a3412]/80">{notes.length} note{notes.length === 1 ? '' : 's'} in this period{po ? ` · ${po} from PO / BOQ` : ''}</p>
      </div>
      {todays.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#c2410c]"><CalendarClock className="h-4 w-4" />Today ({todays.length})</h3>
          <ol className="space-y-2">{todays.map(n => <Item key={n.id} n={n} />)}</ol>
        </div>
      )}
      {rest.length > 0 && (
        <details className="mt-4" open={rest.length <= 6}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-[#c2410c]"><FileCheck2 className="mr-1 inline h-4 w-4" />Earlier in this period ({rest.length})</summary>
          <ol className="mt-2 space-y-2">{rest.map(n => <Item key={n.id} n={n} />)}</ol>
        </details>
      )}
    </section>
  );
}
