import { q } from './db.js';
import { EQUITY_SQL } from '../src/worker/equity.js';

const DEFAULT_BANKROLL = 1000;

export async function loadDashboard() {
  const now = Date.now();
  const [status] = await q('SELECT * FROM worker_status WHERE id = 1');
  const startBankroll = Number(status?.info?.config?.startBankroll ?? process.env.START_BANKROLL ?? DEFAULT_BANKROLL);

  const [eq] = await q(EQUITY_SQL);
  const equityNow = startBankroll + eq.realized + eq.unrealized;

  const snapshots = await q(
    `SELECT ts AS t, equity AS v FROM equity_snapshots WHERE ts > $1 ORDER BY ts`,
    [now - 30 * 86400000]
  );
  const series = [...snapshots, { t: now, v: equityNow }];

  const strategies = await q(`
    SELECT strategy,
      count(*) FILTER (WHERE status IN ('open','won','lost','void')) AS bets,
      count(*) FILTER (WHERE status = 'open') AS open,
      count(*) FILTER (WHERE status IN ('won','lost')) AS settled,
      count(*) FILTER (WHERE status = 'won') AS won,
      coalesce(sum(stake) FILTER (WHERE status IN ('won','lost')), 0) AS staked,
      coalesce(sum(pnl) FILTER (WHERE status IN ('won','lost','void')), 0) AS pnl,
      coalesce(sum(CASE WHEN status = 'won' THEN stake / insider_price - stake - fee
                        WHEN status = 'lost' THEN -stake - fee END), 0) AS pnl_insider
    FROM paper_bets GROUP BY strategy ORDER BY strategy`);

  const delays = await q(`
    SELECT m.delay_sec,
      count(*) AS n_all,
      avg(m.price / b.insider_price - 1) AS drift,
      count(*) FILTER (WHERE b.status IN ('won','lost')) AS n_settled,
      sum(CASE WHEN b.status = 'won' THEN b.stake / m.price - b.stake - b.fee
               WHEN b.status = 'lost' THEN -b.stake - b.fee END) AS pnl,
      sum(b.stake) FILTER (WHERE b.status IN ('won','lost')) AS staked
    FROM paper_bets b JOIN paper_bet_marks m ON m.bet_id = b.id
    WHERE m.price IS NOT NULL AND b.status IN ('open','won','lost')
    GROUP BY m.delay_sec ORDER BY m.delay_sec`);

  const [fills] = await q(`
    SELECT count(*) AS n,
      avg(fill_price / insider_price - 1) AS drift,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY filled_at - trade_ts) AS latency,
      sum(stake) FILTER (WHERE status IN ('won','lost')) AS staked,
      sum(pnl) FILTER (WHERE status IN ('won','lost')) AS pnl,
      sum(stake) FILTER (WHERE status IN ('won','lost')) AS staked_insider,
      sum(CASE WHEN status = 'won' THEN stake / insider_price - stake - fee
               WHEN status = 'lost' THEN -stake - fee END) AS pnl_insider
    FROM paper_bets WHERE status IN ('open','won','lost')`);

  const latency = await q(
    `SELECT k, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY lat) AS p90
     FROM (
       SELECT 'live' AS k, rtds_seen_at - trade_ts AS lat FROM trades WHERE rtds_seen_at IS NOT NULL AND trade_ts > $1
       UNION ALL
       SELECT 'rest', rest_seen_at - trade_ts FROM trades WHERE rest_seen_at IS NOT NULL AND trade_ts > $1
       UNION ALL
       SELECT 'fill', filled_at - trade_ts FROM paper_bets WHERE trade_ts > $2 AND status IN ('open','won','lost')
     ) x GROUP BY k`,
    [now - 86400000, now - 7 * 86400000]
  );

  const betCols = `b.id, b.strategy, b.wallet, b.title, b.outcome, b.insider_price, b.fill_price, b.current_bid,
    b.stake, b.fee, b.trade_ts, b.filled_at, b.status, b.pnl, b.resolved_at, w.name, mk.end_date,
    (SELECT json_object_agg(m.delay_sec, m.price) FROM paper_bet_marks m WHERE m.bet_id = b.id) AS marks`;
  const openBets = await q(`
    SELECT ${betCols} FROM paper_bets b
    LEFT JOIN wallets w ON w.address = b.wallet
    LEFT JOIN markets mk ON mk.condition_id = b.condition_id
    WHERE b.status = 'open' ORDER BY b.filled_at DESC LIMIT 100`);
  const settledBets = await q(`
    SELECT ${betCols} FROM paper_bets b
    LEFT JOIN wallets w ON w.address = b.wallet
    LEFT JOIN markets mk ON mk.condition_id = b.condition_id
    WHERE b.status IN ('won','lost','void') ORDER BY b.resolved_at DESC LIMIT 30`);

  const suspects = await q(`
    SELECT w.address, w.name, w.wins, w.n_resolved, w.expected_wins, w.log10_p, w.pnl_resolved, w.edge, w.first_trade_ts,
      (SELECT max(trade_ts) FROM trades t WHERE t.wallet = w.address) AS last_trade
    FROM wallets w WHERE suspect ORDER BY log10_p ASC LIMIT 40`);

  const [counts] = await q(`
    SELECT (SELECT count(*) FROM trades) AS trades, (SELECT count(*) FROM wallets) AS wallets,
           (SELECT count(*) FROM wallets WHERE suspect) AS suspects`);

  return {
    now,
    status: status ? { updated_at: status.updated_at, started_at: status.started_at, info: status.info } : null,
    bankroll: { start: startBankroll, equity: equityNow, realized: eq.realized, unrealized: eq.unrealized, open: Number(eq.open_count) },
    series,
    strategies,
    delays,
    fills,
    latency: Object.fromEntries(latency.map((l) => [l.k, l])),
    openBets,
    settledBets,
    suspects,
    counts,
  };
}
