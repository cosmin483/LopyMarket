// Paper trading: open imaginary bets at the price we could really have got,
// record what later entries would have cost, and settle when markets resolve.
import { config } from './config.js';
import { query } from './db.js';
import { fetchBook, fetchBestPrices, vwapForStake } from './polymarket.js';
import { getMarkets } from './markets.js';
import { log } from './log.js';
import { EQUITY_SQL } from './equity.js';

async function priceNow(tokenId) {
  try {
    const book = await fetchBook(tokenId);
    return vwapForStake(book?.asks, config.stakeUsd);
  } catch (e) {
    log(`book fetch failed ${tokenId}: ${e.message}`);
    return { price: null, partial: true };
  }
}

export async function openBet(trade, signal) {
  const fill = await priceNow(trade.token_id);
  const filledAt = Date.now();
  let fee = 0;
  try {
    const m = (await getMarkets([trade.condition_id])).get(trade.condition_id);
    if (m?.fees_enabled) fee = (config.stakeUsd * config.takerFeePct) / 100;
  } catch {
    /* fee stays 0 if metadata is unavailable */
  }
  const status = fill.price === null || fill.price >= 0.999 ? 'unfillable' : 'open';
  const { rows } = await query(
    `INSERT INTO paper_bets (signal_id, strategy, wallet, condition_id, token_id, outcome, outcome_index, title,
       insider_price, trade_ts, detected_at, filled_at, fill_price, fill_source, stake, fee, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (strategy, wallet, token_id) DO NOTHING
     RETURNING id`,
    [
      signal.id, signal.strategy, trade.wallet, trade.condition_id, trade.token_id, trade.outcome, trade.outcome_index,
      trade.title, trade.price, trade.trade_ts, trade.received_at, filledAt, fill.price,
      fill.price === null ? 'none' : fill.partial ? 'book_partial' : 'book', config.stakeUsd, fee, status,
    ]
  );
  if (!rows.length) return null; // already copying this wallet on this outcome
  const betId = rows[0].id;
  log(
    `PAPER BET #${betId} [${signal.strategy}] ${trade.title} → ${trade.outcome} ` +
      `insider ${trade.price.toFixed(3)} us ${fill.price?.toFixed(3) ?? 'n/a'} ` +
      `latency ${((filledAt - trade.trade_ts) / 1000).toFixed(1)}s`
  );
  if (status === 'open') scheduleMarks(betId, trade);
  return betId;
}

// "What if we had been N seconds late?" — sample the book at insider time + N s.
function scheduleMarks(betId, trade) {
  for (const delay of config.markDelaysSec) {
    const wait = trade.trade_ts + delay * 1000 - Date.now();
    if (wait < 0) continue; // we were already slower than this
    setTimeout(async () => {
      const p = await priceNow(trade.token_id);
      await query(
        `INSERT INTO paper_bet_marks (bet_id, delay_sec, price, fetched_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [betId, delay, p.price, Date.now()]
      ).catch((e) => log(`mark failed: ${e.message}`));
    }, wait).unref?.();
  }
}

export async function settleOpenBets() {
  const { rows: open } = await query(`SELECT * FROM paper_bets WHERE status = 'open'`);
  if (!open.length) return 0;
  const markets = await getMarkets(open.map((b) => b.condition_id), { maxAgeMs: config.resolveEveryMs - 1000 });
  let settled = 0;
  for (const b of open) {
    const m = markets.get(b.condition_id);
    if (!m || m.status === 'open') continue;
    let status;
    let pnl;
    if (m.status === 'void') {
      status = 'void';
      pnl = 0;
    } else {
      const idx = b.outcome_index ?? (m.token_ids || []).indexOf(b.token_id);
      const won = idx >= 0 && m.winning_index === idx;
      const shares = b.stake / b.fill_price;
      status = won ? 'won' : 'lost';
      pnl = (won ? shares : 0) - b.stake - b.fee;
    }
    await query(`UPDATE paper_bets SET status=$2, pnl=$3, resolved_at=$4 WHERE id=$1`, [b.id, status, pnl, Date.now()]);
    log(`settled bet #${b.id} ${status} pnl ${pnl.toFixed(2)}`);
    settled++;
  }
  return settled;
}

// Re-value open bets at the best bid: what we could sell them for right now.
export async function refreshOpenBetPrices() {
  const { rows } = await query(`SELECT DISTINCT token_id FROM paper_bets WHERE status = 'open'`);
  if (!rows.length) return;
  const prices = await fetchBestPrices(rows.map((r) => r.token_id));
  const now = Date.now();
  for (const [tokenId, p] of prices) {
    if (p.bid === null) continue;
    await query(`UPDATE paper_bets SET current_bid = $2, current_at = $3 WHERE token_id = $1 AND status = 'open'`, [tokenId, p.bid, now]);
  }
}

export async function snapshotEquity() {
  const { rows } = await query(EQUITY_SQL);
  const r = rows[0];
  const equity = config.startBankroll + r.realized + r.unrealized;
  await query(
    `INSERT INTO equity_snapshots (ts, equity, realized, unrealized, open_count) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (ts) DO NOTHING`,
    [Date.now(), equity, r.realized, r.unrealized, Number(r.open_count)]
  );
}
