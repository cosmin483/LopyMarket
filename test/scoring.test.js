import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poissonBinomialTail, walletTrackRecord, scoreTrade, isSuspect } from '../src/worker/scoring.js';
import { vwapForStake, normalizeTrade, parseMarket } from '../src/worker/polymarket.js';

test('poisson-binomial tail matches simple cases', () => {
  assert.ok(Math.abs(poissonBinomialTail([0.5, 0.5], 2) - 0.25) < 1e-12);
  assert.ok(Math.abs(poissonBinomialTail([0.5, 0.5], 1) - 0.75) < 1e-12);
  assert.equal(poissonBinomialTail([0.3, 0.6], 0), 1);
  // 10 straight wins at 15c ≈ 0.15^10 ≈ 5.8e-9
  const p = poissonBinomialTail(Array(10).fill(0.15), 10);
  assert.ok(Math.abs(Math.log10(p) - 10 * Math.log10(0.15)) < 1e-9);
});

const mk = (cid, oi, side, price, size) => ({ condition_id: cid, outcome_index: oi, side, price, size, cash: price * size });

test('track record: long-shot winner is very unlikely, favourite winner is not', () => {
  const markets = new Map();
  const insider = [];
  const favourite = [];
  for (let i = 0; i < 8; i++) {
    markets.set(`c${i}`, { status: 'resolved', winning_index: 0 });
    insider.push(mk(`c${i}`, 0, 'BUY', 0.12, 1000));
    favourite.push(mk(`c${i}`, 0, 'BUY', 0.95, 1000));
  }
  const a = walletTrackRecord(insider, markets);
  const b = walletTrackRecord(favourite, markets);
  assert.equal(a.wins, 8);
  assert.equal(b.wins, 8);
  assert.ok(a.log10_p < -7, `insider log10p ${a.log10_p}`);
  assert.ok(b.log10_p > -0.5, `favourite log10p ${b.log10_p}`);
  assert.ok(isSuspect(a, { minResolved: 5, maxLog10P: -4 }));
  assert.ok(!isSuspect(b, { minResolved: 5, maxLog10P: -4 }));
  assert.ok(Math.abs(a.pnl_resolved - 8 * (1000 - 120)) < 1e-6);
});

test('track record ignores unresolved markets and dust', () => {
  const markets = new Map([['a', { status: 'open' }], ['b', { status: 'resolved', winning_index: 1 }]]);
  const r = walletTrackRecord([mk('a', 0, 'BUY', 0.1, 1000), mk('b', 0, 'BUY', 0.1, 50)], markets);
  assert.equal(r.n_resolved, 0);
});

const cfg = { longshotMaxPrice: 0.35, freshWalletDays: 14, sensitiveKeywords: ['strike', 'iran', 'c++'] };

test('fresh wallet buying a big long shot on a sensitive market scores high', () => {
  const now = Date.now();
  const trade = { side: 'BUY', cash: 25000, price: 0.08, title: 'US strike on Iran by Friday?', event_slug: '' };
  const wallet = { first_trade_ts: now - 3600000, history_capped: false, n_markets: 1, n_resolved: 0, log10_p: 0 };
  const { score, reasons } = scoreTrade(trade, wallet, cfg, now);
  assert.equal(score, 100);
  assert.ok(reasons.some((r) => r.includes('sensitive')));
});

test('old busy wallet buying a favourite scores low', () => {
  const trade = { side: 'BUY', cash: 1500, price: 0.7, title: 'Will it rain?', event_slug: '' };
  const wallet = { first_trade_ts: 0, history_capped: true, n_markets: 400, n_resolved: 300, log10_p: -0.3 };
  assert.ok(scoreTrade(trade, wallet, cfg).score < 20);
});

test('keywords with regex characters do not crash', () => {
  const trade = { side: 'BUY', cash: 1500, price: 0.1, title: 'c++ release?', event_slug: '' };
  assert.doesNotThrow(() => scoreTrade(trade, null, cfg));
});

test('vwap walks the asks best first', () => {
  const asks = [{ price: '0.30', size: '100' }, { price: '0.20', size: '10' }]; // descending, as the CLOB returns
  const r = vwapForStake(asks, 10); // $2 at 0.20 (10 sh), $8 at 0.30 (26.67 sh)
  assert.ok(Math.abs(r.price - 10 / (10 + 8 / 0.3)) < 1e-9);
  assert.equal(r.partial, false);
  assert.equal(vwapForStake([], 10).price, null);
  assert.equal(vwapForStake([{ price: '0.5', size: '2' }], 10).partial, true);
});

test('normalizes both feed shapes to the same id', () => {
  const rest = { proxy_wallet: '0xAB', side: 'BUY', token_id: '123', condition_id: '0xC', size: 100, price: 0.1, timestamp: 1700000000, transaction_hash: '0xT', outcome_index: 0 };
  const live = { proxyWallet: '0xab', side: 'BUY', asset: '123', conditionId: '0xc', size: '100', price: '0.1', timestamp: 1700000000, transactionHash: '0xt', outcomeIndex: 0 };
  const a = normalizeTrade(rest, 'rest');
  const b = normalizeTrade(live, 'rtds');
  assert.equal(a.id, b.id);
  assert.equal(a.trade_ts, 1700000000000);
  assert.equal(a.cash, 10);
});

test('parses resolved, void and open markets', () => {
  assert.deepEqual(
    [parseMarket({ conditionId: '0x1', closed: true, outcomePrices: '["0","1"]' })].map((m) => [m.status, m.winning_index]),
    [['resolved', 1]]
  );
  assert.equal(parseMarket({ conditionId: '0x1', closed: true, outcomePrices: '["0.5","0.5"]' }).status, 'void');
  assert.equal(parseMarket({ conditionId: '0x1', closed: false, outcomePrices: '["0.2","0.8"]' }).status, 'open');
});

test('favourite-grinders and sharp traders are not suspects, long-shot insiders are', () => {
  const opts = { minResolved: 5, maxLog10P: -4, minEdge: 0.15 };
  const markets = new Map();
  const grinder = [];
  const sharp = [];
  for (let i = 0; i < 900; i++) {
    markets.set(`g${i}`, { status: 'resolved', winning_index: i < 897 ? 0 : 1 });
    grinder.push(mk(`g${i}`, 0, 'BUY', 0.97, 1000)); // like 930/933 vs 903.7 expected
  }
  for (let i = 0; i < 430; i++) {
    markets.set(`s${i}`, { status: 'resolved', winning_index: i < 280 ? 0 : 1 });
    sharp.push(mk(`s${i}`, 0, 'BUY', 0.54, 1000)); // edge ~0.11 per bet over 430 bets
  }
  const g = walletTrackRecord(grinder, markets, { maxEntry: 0.7 });
  assert.equal(g.n_resolved, 0, 'near-certain favourites are excluded from the record');
  const sh = walletTrackRecord(sharp, markets, { maxEntry: 0.7 });
  assert.ok(sh.log10_p < -4, 'statistically significant…');
  assert.ok(!isSuspect(sh, opts), '…but a small edge per bet is skill, not inside information');
});

test('sports markets can be excluded from track records', () => {
  const markets = new Map([['m', { status: 'resolved', winning_index: 0, is_sports: true }]]);
  assert.equal(walletTrackRecord([mk('m', 0, 'BUY', 0.1, 1000)], markets, { excludeSports: true }).n_resolved, 0);
});

test('sports titles are recognised', async () => {
  const { looksLikeSports } = await import('../src/worker/polymarket.js');
  assert.ok(looksLikeSports('Dota 2: 1win vs Team Liquid - Game 2 Winner'));
  assert.ok(looksLikeSports('Will Mjällby AIF win on 2026-11-26?'));
  assert.ok(!looksLikeSports('US strike on Iran by Friday?'));
});
