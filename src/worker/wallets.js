// Fetches a wallet's full history, builds its track record and stores it.
import { config } from './config.js';
import { query } from './db.js';
import { getMarkets } from './markets.js';
import { fetchWalletTrades, normalizeTrade } from './polymarket.js';
import { walletTrackRecord, isSuspect } from './scoring.js';
import { log } from './log.js';

// Bump when the scoring rules change; older scores are recomputed on start-up.
export const SCORE_VERSION = 2;

export async function getWallet(address) {
  const { rows } = await query('SELECT * FROM wallets WHERE address = $1', [address]);
  return rows[0] || null;
}

const isFresh = (w) => w && w.scored_at && w.score_version === SCORE_VERSION && Date.now() - w.scored_at < config.walletRescoreHours * 3600000;

// Returns the stored wallet row, (re)scoring it first if missing or stale.
// `force` rescoring is used when a known wallet makes a new trade we may copy,
// because a fresh wallet's age/market count changes with every trade.
export async function ensureWalletScored(address, { force = false } = {}) {
  const existing = await getWallet(address);
  if (!force && isFresh(existing)) return existing;
  return scoreWallet(address);
}

export async function scoreWallet(address) {
  const { rows: raw, capped } = await fetchWalletTrades(address, config.walletHistoryMaxTrades);
  const trades = raw.map((r) => normalizeTrade(r, 'history')).filter(Boolean);
  const markets = await getMarkets(trades.map((t) => t.condition_id), { maxAgeMs: 6 * 3600000 });
  const rec = walletTrackRecord(trades, markets, {
    minPositionUsd: config.scoreMinPositionUsd,
    maxEntry: config.trackRecordMaxEntry,
    excludeSports: config.excludeSports,
  });
  const firstTs = trades.length ? Math.min(...trades.map((t) => t.trade_ts)) : null;
  const suspect = isSuspect(rec, {
    minResolved: config.suspectMinResolved,
    maxLog10P: config.suspectMaxLog10P,
    minEdge: config.suspectMinEdge,
  });
  const name = trades.find((t) => t.name)?.name ?? null;

  const { rows } = await query(
    `INSERT INTO wallets (address, first_trade_ts, history_capped, n_trades, n_markets, n_resolved, wins,
       expected_wins, z_score, log10_p, cost_resolved, pnl_resolved, suspect, name, scored_at, score_version, edge)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (address) DO UPDATE SET first_trade_ts=EXCLUDED.first_trade_ts, history_capped=EXCLUDED.history_capped,
       n_trades=EXCLUDED.n_trades, n_markets=EXCLUDED.n_markets, n_resolved=EXCLUDED.n_resolved, wins=EXCLUDED.wins,
       expected_wins=EXCLUDED.expected_wins, z_score=EXCLUDED.z_score, log10_p=EXCLUDED.log10_p,
       cost_resolved=EXCLUDED.cost_resolved, pnl_resolved=EXCLUDED.pnl_resolved, suspect=EXCLUDED.suspect,
       name=COALESCE(EXCLUDED.name, wallets.name), scored_at=EXCLUDED.scored_at,
       score_version=EXCLUDED.score_version, edge=EXCLUDED.edge
     RETURNING *`,
    [
      address, capped ? null : firstTs, capped, trades.length, rec.n_markets, rec.n_resolved, rec.wins,
      rec.expected_wins, rec.z_score, rec.log10_p, rec.cost_resolved, rec.pnl_resolved, suspect, name, Date.now(),
      SCORE_VERSION, rec.edge,
    ]
  );
  if (suspect) {
    log(`suspect wallet ${address}: ${rec.wins}/${rec.n_resolved} wins vs ${rec.expected_wins.toFixed(1)} expected, odds 1e${rec.log10_p.toFixed(1)}`);
  }
  return rows[0];
}

// Background queue: every wallet that makes a big trade gets its track record
// built, so suspects are discovered over time even before they trade again.
const queued = new Set();
const inFlight = new Set();
const MAX_QUEUE = 5000;

export function queueWallet(address) {
  if (queued.has(address) || inFlight.has(address) || queued.size >= MAX_QUEUE) return;
  queued.add(address);
  pump();
}

export const queueSize = () => queued.size + inFlight.size;

function pump() {
  while (inFlight.size < config.walletQueueConcurrency && queued.size) {
    const address = queued.values().next().value;
    queued.delete(address);
    inFlight.add(address);
    ensureWalletScored(address)
      .catch((e) => log(`wallet score failed ${address}: ${e.message}`))
      .finally(() => {
        inFlight.delete(address);
        setTimeout(pump, 250); // gentle on the API
      });
  }
}
