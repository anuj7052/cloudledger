import { useEffect, useState } from 'react';
import { listCostNotes } from '../api/client';

/** All notes for a tenant/subscription selection in [from, to] (YYYY-MM-DD). */
export function useCostNotes(tenantId, subscriptionIds = [], from = '', to = '') {
  const [notes, setNotes] = useState([]);
  const key = subscriptionIds.join(',');
  useEffect(() => {
    if (!tenantId || !from || !to) return undefined;
    let live = true;
    listCostNotes({ tenant_id: tenantId, from_date: from, to_date: to, subscription_ids: subscriptionIds })
      .then(list => { if (live) setNotes(list || []); })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [tenantId, from, to, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return notes;
}

/** First and last day covered by chart rows (day keys, or month keys like 2026-10 / 2026-10-01). */
export function rowsRange(rows = [], daily = false) {
  if (!rows.length) return ['', ''];
  const first = String(rows[0].key), last = String(rows.at(-1).key);
  if (daily) return [first.slice(0, 10), last.slice(0, 10)];
  const [y, m] = last.slice(0, 7).split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [`${first.slice(0, 7)}-01`, end];
}
