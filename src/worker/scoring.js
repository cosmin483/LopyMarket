// Pure scoring functions (no I/O) so they are easy to test.

const DAY = 86400000;

// P(W >= wins) where W is the number of wins among independent bets with win
// probabilities ps (Poisson-binomial upper tail). O(n^2), fine for a few thousand bets.
export function poissonBinomialTail(ps, wins) {
  let dist = new Float64Array(ps.length + 1);
  dist[0] = 1;
  ps.forEach((p, i) => {
    const next = new Float64Array(ps.length + 1);
    for (let k = 0; k <= i; k++) {
      if (dist[k] === 0) continue;
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  });
  let tail = 0;
  for (let k = wins; k <= ps.length; k++) tail += dist[k];
  return Math.min(1, tail);
}

// Turn a wallet's raw trades into per-position track-record stats.
// `markets` maps condition_id -> { status, winning_index }.
// A "position" is one (market, outcome) the wallet bought. Its implied win
// probability is the average price it paid — what the market thought at the time.
export function walletTrackRecord(trades, markets, { minPositionUsd = 20 } = {}) {
  const positions = new Map();
  for (const t of trades) {
    if (t.outcome_index === null || t.outcome_index === undefined) continue;
    const key = `${t.condition_id}:${t.outcome_index}`;
    let p = positions.get(key);
    if (!p) {
      p = { condition_id: t.condition_id, outcome_index: t.outcome_index, buyShares: 0, buyCost: 0, sellShares: 0, sellCash: 0 };
      positions.set(key, p);
    }
    if (t.side === 'BUY') {
      p.buyShares += t.size;
      p.buyCost += t.cash;
    } else if (t.side === 'SELL') {
      p.sellShares += t.size;
      p.sellCash += t.cash;
    }
  }

  const probs = [];
  let wins = 0;
  let cost = 0;
  let pnl = 0;
  for (const p of positions.values()) {
    if (p.buyCost < minPositionUsd || p.buyShares <= 0) continue;
    const m = markets.get(p.condition_id);
    if (!m || m.status !== 'resolved') continue;
    const won = m.winning_index === p.outcome_index;
    const entry = Math.min(0.999, Math.max(0.001, p.buyCost / p.buyShares));
    const held = Math.max(0, p.buyShares - p.sellShares);
    probs.push(entry);
    if (won) wins++;
    cost += p.buyCost;
    pnl += p.sellCash + (won ? held : 0) - p.buyCost;
  }

  const n = probs.length;
  const expected = probs.reduce((a, b) => a + b, 0);
  const variance = probs.reduce((a, p) => a + p * (1 - p), 0);
  const z = variance > 0 ? (wins - expected) / Math.sqrt(variance) : 0;
  const tail = n ? poissonBinomialTail(probs, wins) : 1;
  const log10p = tail > 0 ? Math.log10(tail) : -300;

  return {
    n_markets: new Set(trades.map((t) => t.condition_id)).size,
    n_resolved: n,
    wins,
    expected_wins: expected,
    z_score: z,
    log10_p: Math.max(-300, log10p),
    cost_resolved: cost,
    pnl_resolved: pnl,
  };
}

export function isSuspect(rec, { minResolved, maxLog10P }) {
  return rec.n_resolved >= minResolved && rec.log10_p <= maxLog10P && rec.pnl_resolved > 0;
}

// Early-warning score for a single BUY trade (0..100) with human-readable reasons.
export function scoreTrade(trade, wallet, cfg, now = Date.now()) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => {
    score += pts;
    reasons.push(`+${pts} ${why}`);
  };

  if (trade.side !== 'BUY') return { score: 0, reasons: ['not a buy'] };

  if (trade.cash >= 20000) add(30, `size $${Math.round(trade.cash)}`);
  else if (trade.cash >= 5000) add(20, `size $${Math.round(trade.cash)}`);
  else if (trade.cash >= 1000) add(10, `size $${Math.round(trade.cash)}`);

  if (trade.price <= 0.15) add(25, `long shot at ${trade.price.toFixed(2)}`);
  else if (trade.price <= cfg.longshotMaxPrice) add(15, `underdog at ${trade.price.toFixed(2)}`);

  if (wallet) {
    if (wallet.first_trade_ts && !wallet.history_capped) {
      const ageDays = (now - wallet.first_trade_ts) / DAY;
      if (ageDays <= 2) add(30, `wallet ${ageDays.toFixed(1)} days old`);
      else if (ageDays <= cfg.freshWalletDays) add(20, `wallet ${ageDays.toFixed(0)} days old`);
    }
    if (wallet.n_markets !== null && wallet.n_markets !== undefined && wallet.n_markets <= 5 && !wallet.history_capped) {
      add(10, `only ${wallet.n_markets} markets traded`);
    }
    if (wallet.n_resolved >= 3 && wallet.log10_p !== null) {
      if (wallet.log10_p <= -4) add(30, `track record odds 1e${wallet.log10_p.toFixed(1)}`);
      else if (wallet.log10_p <= -2) add(15, `track record odds 1e${wallet.log10_p.toFixed(1)}`);
    }
  }

  const text = `${trade.title || ''} ${trade.event_slug || ''}`.toLowerCase();
  const hit = cfg.sensitiveKeywords.find((k) =>
    new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
  );
  if (hit) add(15, `sensitive topic ("${hit}")`);

  return { score: Math.min(100, score), reasons };
}
