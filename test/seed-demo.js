// Fills a scratch database with plausible demo data for checking the dashboard's look.
// Usage: DATABASE_URL=postgres://… node test/seed-demo.js   (never point this at production)
import pg from 'pg';
import { SCHEMA_SQL } from '../src/worker/schema.js';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query(SCHEMA_SQL);
await db.query('TRUNCATE trades, markets, wallets, signals, paper_bets, paper_bet_marks, equity_snapshots, worker_status CASCADE');

const now = Date.now();
const H = 3600e3;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const addr = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

await db.query(`INSERT INTO worker_status (id, updated_at, started_at, info) VALUES (1,$1,$2,$3)`, [
  now - 4000, now - 70 * H,
  { rtds: { connected: true }, config: { startBankroll: 1000, signalThreshold: 60 }, walletQueue: 3 },
]);

// Bankroll random walk over 3 days, drifting up.
let eq = 1000;
for (let t = now - 72 * H; t < now; t += 5 * 60e3) {
  eq += (rnd() - 0.46) * 1.6 + (rnd() < 0.01 ? 18 : 0) - (rnd() < 0.008 ? 10 : 0);
  await db.query(`INSERT INTO equity_snapshots VALUES ($1,$2,0,0,0)`, [t, eq]);
}

const people = ['Quiet-Harbor', 'Velvet-Sentinel', 'Sable-Courier', null, 'Northbound-Ember', 'Glass-Lantern'];
const wallets = people.map((name) => ({ address: addr(), name }));
for (const [i, w] of wallets.entries()) {
  const n = 6 + Math.floor(rnd() * 14);
  const exp = n * (0.12 + rnd() * 0.1);
  const wins = Math.min(n, Math.round(exp + n * (0.35 + rnd() * 0.3)));
  await db.query(
    `INSERT INTO wallets (address, name, first_trade_ts, n_trades, n_markets, n_resolved, wins, expected_wins, log10_p, pnl_resolved, edge, suspect, scored_at, score_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,2)`,
    [w.address, w.name, now - (20 + i * 30) * 24 * H, n * 3, n + 2, n, wins, exp, -(4 + rnd() * 7), 4000 + rnd() * 90000, (wins - exp) / n, i < 5, now]
  );
}

const marketsList = [
  ['Will Israel strike Iranian nuclear facilities before December?', 'Yes', 0.11, 30 * H],
  ['US announces new sanctions on Venezuelan oil by Nov 30?', 'Yes', 0.18, 4 * 24 * H],
  ['Will the Fed announce an emergency rate cut in 2026?', 'No', 0.27, 34 * 24 * H],
  ['Ceasefire between Russia and Ukraine announced by Dec 31?', 'Yes', 0.07, 2.2 * H],
  ['Will OpenAI release GPT-6 before January?', 'Yes', 0.22, 11 * H],
  ['Pentagon confirms troop deployment to Taiwan Strait?', 'No', 0.31, 0.6 * H],
];
for (const [i, [title, outcome, ins, endIn]] of marketsList.entries()) {
  const cid = `0xdemo${i}`;
  const tradeTs = Math.round(now - (1 + rnd() * 20) * H);
  const fill = ins * (1.05 + rnd() * 0.2);
  const cur = fill * (0.75 + rnd() * 0.8);
  await db.query(`INSERT INTO markets (condition_id, question, status, end_date, fetched_at, is_sports) VALUES ($1,$2,'open',$3,$4,false)`, [
    cid, title, new Date(now + endIn).toISOString(), now,
  ]);
  const w = wallets[i % wallets.length];
  const { rows } = await db.query(
    `INSERT INTO paper_bets (strategy, wallet, condition_id, token_id, outcome, outcome_index, title, insider_price, trade_ts, detected_at, filled_at, fill_price, fill_source, stake, fee, status, current_bid)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,'book',10,0,'open',$12) RETURNING id`,
    [i % 3 === 0 ? 'suspect' : 'early', w.address, cid, `tok${i}`, outcome, title, ins, tradeTs, tradeTs + 700, Math.round(tradeTs + 900 + rnd() * 600), fill, cur]
  );
  for (const [d, k] of [[5, 1.08], [30, 1.17], [120, 1.29], [600, 1.42]]) {
    await db.query(`INSERT INTO paper_bet_marks VALUES ($1,$2,$3,$4)`, [rows[0].id, d, ins * (k + rnd() * 0.08), Math.round(tradeTs + d * 1000)]);
  }
}

const settled = [
  ['Will Maduro leave office before December?', 'Yes', 0.09, true],
  ['Apple announces acquisition of a major AI lab in November?', 'No', 0.34, true],
  ['US military strike on Houthi targets by Nov 20?', 'Yes', 0.14, true],
  ['Will Netanyahu resign in November?', 'Yes', 0.06, false],
  ['FDA approves orforglipron by Nov 25?', 'Yes', 0.21, true],
  ['Supreme Court nominee announced before Thanksgiving?', 'Yes', 0.12, false],
  ['Will Nvidia announce a stock split in November?', 'No', 0.29, true],
];
for (const [i, [title, outcome, ins, won]] of settled.entries()) {
  const tradeTs = Math.round(now - (30 + i * 9) * H);
  const fill = ins * (1.06 + rnd() * 0.15);
  const pnl = won ? 10 / fill - 10 : -10;
  const w = wallets[(i + 2) % wallets.length];
  const { rows } = await db.query(
    `INSERT INTO paper_bets (strategy, wallet, condition_id, token_id, outcome, outcome_index, title, insider_price, trade_ts, detected_at, filled_at, fill_price, fill_source, stake, fee, status, pnl, resolved_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,'book',10,0,$12,$13,$14) RETURNING id`,
    [i % 2 ? 'suspect' : 'early', w.address, `0xs${i}`, `st${i}`, outcome, title, ins, tradeTs, tradeTs + 800, tradeTs + 1100, fill, won ? 'won' : 'lost', pnl, Math.round(now - i * 7 * H)]
  );
  for (const [d, k] of [[5, 1.07], [30, 1.15], [120, 1.31], [600, 1.48]]) {
    await db.query(`INSERT INTO paper_bet_marks VALUES ($1,$2,$3,$4)`, [rows[0].id, d, ins * k, Math.round(tradeTs + d * 1000)]);
  }
}

// Trades for the latency panel.
for (let i = 0; i < 400; i++) {
  const ts = Math.round(now - rnd() * 20 * H);
  await db.query(
    `INSERT INTO trades (id, wallet, condition_id, token_id, side, price, size, cash, trade_ts, received_at, source, rtds_seen_at, rest_seen_at)
     VALUES ($1,$2,'c','t','BUY',0.5,4000,2000,$3,$4,'rtds',$4,$5)`,
    [`demo${i}`, addr(), ts, Math.round(ts + 400 + rnd() * 1400), Math.round(ts + 6000 + rnd() * 14000)]
  );
}
console.log('demo data seeded');
await db.end();
