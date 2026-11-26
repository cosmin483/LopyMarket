// LopyMarket worker: always-on process that watches Polymarket trades,
// flags suspicious wallets and paper-trades copying them.
import { config } from './config.js';
import { pool, query, migrate } from './db.js';
import { normalizeTrade, fetchRecentTrades } from './polymarket.js';
import { handleTrade, stats } from './ingest.js';
import { startRtds, rtdsState } from './rtds.js';
import { settleOpenBets } from './paper.js';
import { queueSize, queueWallet } from './wallets.js';
import { log } from './log.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const startedAt = Date.now();
const timers = [];
const every = (ms, fn) => {
  const run = () => fn().catch((e) => log(`${fn.name} failed: ${e.message}`));
  run();
  timers.push(setInterval(run, ms));
};

// The REST feed returns the same recent trades on every poll; only handle each once.
const restSeen = new Set();
async function restPoll() {
  const rows = await fetchRecentTrades(config.minTradeUsd);
  const now = Date.now();
  // Oldest first so signals fire in chronological order.
  for (const r of rows.reverse()) {
    const t = normalizeTrade(r, 'rest', now);
    if (!t || restSeen.has(t.id)) continue;
    restSeen.add(t.id);
    await handleTrade(t);
  }
  if (restSeen.size > 50000) {
    const keep = [...restSeen].slice(-20000);
    restSeen.clear();
    keep.forEach((id) => restSeen.add(id));
  }
}

async function heartbeat() {
  const info = {
    rtds: { ...rtdsState },
    stats: { ...stats },
    walletQueue: queueSize(),
    config: {
      minTradeUsd: config.minTradeUsd,
      signalThreshold: config.signalThreshold,
      stakeUsd: config.stakeUsd,
      markDelaysSec: config.markDelaysSec,
    },
  };
  await query(
    `INSERT INTO worker_status (id, updated_at, started_at, info) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET updated_at=EXCLUDED.updated_at, started_at=EXCLUDED.started_at, info=EXCLUDED.info`,
    [Date.now(), startedAt, JSON.stringify(info)]
  );
}

async function settle() {
  await settleOpenBets();
}

// Rescore wallets we've seen trade big recently, so track records include newly resolved markets.
async function rescoreRecent() {
  const { rows } = await query(
    `SELECT w.address FROM wallets w
     WHERE w.scored_at < $1 AND EXISTS (SELECT 1 FROM trades t WHERE t.wallet = w.address AND t.trade_ts > $2)
     ORDER BY w.scored_at ASC LIMIT 200`,
    [Date.now() - config.walletRescoreHours * 3600000, Date.now() - 30 * 86400000]
  );
  rows.forEach((r) => queueWallet(r.address));
}

async function prune() {
  await query(
    `DELETE FROM trades t WHERE t.trade_ts < $1
     AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.trade_id = t.id)`,
    [Date.now() - config.tradeRetentionDays * 86400000]
  );
}

async function main() {
  await migrate();
  log('database ready');

  let stopRtds = () => {};
  if (config.enableRtds) {
    stopRtds = startRtds((payload, receivedAt) => handleTrade(normalizeTrade(payload, 'rtds', receivedAt)));
  }
  every(config.restPollMs, restPoll);
  every(30000, heartbeat);
  every(config.resolveEveryMs, settle);
  every(60 * 60 * 1000, rescoreRecent);
  every(6 * 60 * 60 * 1000, prune);
  every(60000, async function summary() {
    log(`seen ${stats.seen} stored ${stats.stored} signals ${stats.signals} bets ${stats.bets} errors ${stats.errors} ` +
      `rtds ${rtdsState.connected ? 'up' : 'down'} queue ${queueSize()}`);
  });

  const shutdown = async () => {
    log('shutting down');
    stopRtds();
    timers.forEach(clearInterval);
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
