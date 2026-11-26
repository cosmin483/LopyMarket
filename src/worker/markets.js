// Market metadata/resolution cache backed by the `markets` table.
import { query } from './db.js';
import { fetchMarkets } from './polymarket.js';

const OPEN_REFRESH_MS = 10 * 60 * 1000; // re-check unresolved markets at most every 10 min

export async function getMarkets(conditionIds, { maxAgeMs = OPEN_REFRESH_MS } = {}) {
  const ids = [...new Set(conditionIds.filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;

  const { rows } = await query('SELECT * FROM markets WHERE condition_id = ANY($1)', [ids]);
  const now = Date.now();
  const stale = [];
  const cached = new Map(rows.map((r) => [r.condition_id, r]));
  for (const id of ids) {
    const r = cached.get(id);
    // Settled markets never change; open ones get refreshed when stale.
    // Rows cached before sports detection existed (is_sports null) are refetched once.
    if (r && r.is_sports !== null && (r.status !== 'open' || now - r.fetched_at < maxAgeMs)) result.set(id, r);
    else stale.push(id);
  }

  if (stale.length) {
    const fresh = await fetchMarkets(stale);
    for (const m of fresh) {
      await query(
        `INSERT INTO markets (condition_id, question, slug, closed, status, winning_index, fees_enabled, end_date, fetched_at, token_ids, is_sports)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (condition_id) DO UPDATE SET question=EXCLUDED.question, slug=EXCLUDED.slug,
           closed=EXCLUDED.closed, status=EXCLUDED.status, winning_index=EXCLUDED.winning_index,
           fees_enabled=EXCLUDED.fees_enabled, end_date=EXCLUDED.end_date, fetched_at=EXCLUDED.fetched_at, token_ids=EXCLUDED.token_ids, is_sports=EXCLUDED.is_sports`,
        [m.condition_id, m.question, m.slug, m.closed, m.status, m.winning_index, m.fees_enabled, m.end_date, now, JSON.stringify(m.token_ids), m.is_sports]
      );
      result.set(m.condition_id, { ...m, fetched_at: now });
    }
    // Fall back to stale cache rows for anything Gamma didn't return.
    for (const id of stale) if (!result.has(id) && cached.has(id)) result.set(id, cached.get(id));
  }
  return result;
}
