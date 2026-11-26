// Fake Polymarket APIs (Data API, Gamma, CLOB, RTDS) for end-to-end testing.
// Usage: node test/mock-server.js  (listens on :4010, ws on :4011)
import http from 'node:http';
import { WebSocketServer } from 'ws';

const now = () => Math.floor(Date.now() / 1000);
const FRESH = '0xf7e5h00000000000000000000000000000000001';
const SUSPECT = '0x5u5pec7000000000000000000000000000000002';
const IRAN = '0xc1';

// The suspect has 8 past long shots that all won.
const suspectHistory = Array.from({ length: 8 }, (_, i) => ({
  proxy_wallet: SUSPECT, side: 'BUY', token_id: `old${i}`, condition_id: `0xold${i}`, size: 5000, price: 0.1,
  timestamp: now() - 86400 * (40 - i), transaction_hash: `0xh${i}`, outcome_index: 0, title: `Old market ${i}`,
}));

const markets = {
  [IRAN]: { conditionId: IRAN, question: 'US strike on Iran by Friday?', endDate: new Date(Date.now() + 3 * 3600e3).toISOString(), closed: false, outcomePrices: '["0.08","0.92"]', clobTokenIds: '["tokYes","tokNo"]', feesEnabled: false },
};
for (let i = 0; i < 8; i++) markets[`0xold${i}`] = { conditionId: `0xold${i}`, closed: true, outcomePrices: '["1","0"]', clobTokenIds: `["old${i}","oldn${i}"]` };

let bookAsk = 0.09;
const liveTrades = [];

// An esports market (should be skipped) and an old trade in the REST backlog (should not be bet on).
markets['0xdota'] = { conditionId: '0xdota', question: 'Dota 2: 1win vs Team Liquid - Game 2 Winner', closed: false, outcomePrices: '["0.25","0.75"]', clobTokenIds: '["d1","d2"]' };
liveTrades.push({ proxy_wallet: '0xold0000000000000000000000000000000000099', side: 'BUY', token_id: 'tokYes', condition_id: IRAN, size: 100000, price: 0.07, timestamp: now() - 3600, transaction_hash: '0xold', outcome_index: 0, title: 'US strike on Iran by Friday?' });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === '/v2/trades') {
    const user = url.searchParams.get('user');
    if (user === SUSPECT) return send({ data: suspectHistory, pagination: { next_cursor: null, has_more: false } });
    if (user) return send({ data: [], pagination: { next_cursor: null, has_more: false } }); // brand new wallet
    return send({ data: liveTrades, pagination: { next_cursor: null, has_more: false } });
  }
  if (url.pathname === '/markets') {
    const ids = url.searchParams.getAll('condition_ids');
    return send(ids.map((id) => markets[id]).filter(Boolean));
  }
  if (url.pathname === '/books' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ids = JSON.parse(body).map((x) => x.token_id);
      send(ids.map((id) => ({ asset_id: id, bids: [{ price: String(bookAsk - 0.01), size: '500' }], asks: [{ price: String(bookAsk), size: '500' }] })));
    });
    return;
  }
  if (url.pathname === '/book') {
    return send({ asks: [{ price: String(bookAsk + 0.02), size: '1000' }, { price: String(bookAsk), size: '50' }], bids: [] });
  }
  if (url.pathname === '/control/resolve') {
    markets[IRAN] = { ...markets[IRAN], closed: true, outcomePrices: '["1","0"]' };
    return send({ ok: true });
  }
  res.writeHead(404);
  res.end();
});
server.listen(4010);

const wss = new WebSocketServer({ port: 4011 });
wss.on('connection', (ws) => {
  ws.on('message', (m) => {
    if (m.toString() === 'ping') return ws.send('pong');
    // After subscribe: emit a small trade (ignored), then the two interesting ones.
    setTimeout(() => {
      const base = { side: 'BUY', conditionId: IRAN, title: 'US strike on Iran by Friday?', eventSlug: 'us-strike-iran', outcome: 'Yes', outcomeIndex: 0, asset: 'tokYes' };
      const small = { ...base, proxyWallet: '0xsmall', size: 10, price: 0.08, timestamp: now(), transactionHash: '0xs' };
      const fresh = { ...base, proxyWallet: FRESH, size: 250000, price: 0.08, timestamp: now(), transactionHash: '0xf' };
      const sus = { ...base, proxyWallet: SUSPECT, size: 20000, price: 0.85, timestamp: now(), transactionHash: '0xsu' };
      const dota = { ...base, conditionId: '0xdota', asset: 'd1', title: 'Dota 2: 1win vs Team Liquid - Game 2 Winner', eventSlug: 'dota2', proxyWallet: '0xd07a000000000000000000000000000000000007', size: 100000, price: 0.25, timestamp: now(), transactionHash: '0xd' };
      for (const p of [small, fresh, sus, dota]) ws.send(JSON.stringify({ topic: 'activity', type: 'trades', timestamp: Date.now(), payload: p }));
      // Same fresh trade also shows up in REST later (should dedupe, record rest_seen_at)
      liveTrades.push({ proxy_wallet: FRESH, side: 'BUY', token_id: 'tokYes', condition_id: IRAN, size: 250000, price: 0.08, timestamp: fresh.timestamp, transaction_hash: '0xf', outcome_index: 0, title: base.title });
      setTimeout(() => {
        bookAsk = 0.2; // price runs away after the insider buys
        // Suspect trades again; by now it has been scored, so it should be copied.
        const sus2 = { ...sus, size: 30000, price: 0.6, outcome: 'No', outcomeIndex: 1, asset: 'tokNo', transactionHash: '0xsu2', timestamp: now() };
        ws.send(JSON.stringify({ topic: 'activity', type: 'trades', timestamp: Date.now(), payload: sus2 }));
      }, 3000);
    }, 300);
  });
});
console.log('mock up');
