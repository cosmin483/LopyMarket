// Thin clients for the public Polymarket APIs plus normalisation into one trade shape.
import { config } from './config.js';
import { getJson } from './http.js';

const toMs = (ts) => {
  const n = Number(ts);
  if (!Number.isFinite(n)) return Date.now();
  return n > 1e12 ? n : n * 1000; // feeds use epoch seconds; tolerate ms
};

// The RTDS feed uses camelCase, the Data API v2 snake_case. Accept either.
export function normalizeTrade(raw, source, receivedAt = Date.now()) {
  const pick = (...keys) => {
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    return undefined;
  };
  const wallet = String(pick('proxy_wallet', 'proxyWallet') || '').toLowerCase();
  const tokenId = String(pick('token_id', 'asset', 'asset_id', 'tokenId') ?? '');
  const conditionId = String(pick('condition_id', 'conditionId') || '').toLowerCase();
  const side = String(pick('side') || '').toUpperCase();
  const price = Number(pick('price'));
  const size = Number(pick('size'));
  if (!wallet || !tokenId || !conditionId || !(price > 0) || !(size > 0)) return null;
  const txHash = String(pick('transaction_hash', 'transactionHash') || '').toLowerCase();
  const oi = pick('outcome_index', 'outcomeIndex');
  return {
    id: [txHash, tokenId, wallet, side, size.toFixed(6), price.toFixed(4)].join(':'),
    tx_hash: txHash,
    wallet,
    condition_id: conditionId,
    token_id: tokenId,
    side,
    outcome: pick('outcome') ?? null,
    outcome_index: oi === undefined || Number(oi) === 999 ? null : Number(oi),
    price,
    size,
    cash: price * size,
    title: pick('title') ?? null,
    slug: pick('slug') ?? null,
    event_slug: pick('event_slug', 'eventSlug') ?? null,
    name: pick('pseudonym', 'name') ?? null,
    trade_ts: toMs(pick('timestamp')),
    received_at: receivedAt,
    source,
  };
}

// ---- Data API v2 -------------------------------------------------------------

export async function fetchRecentTrades(minCash, limit = 500) {
  const url = `${config.dataApi}/v2/trades?limit=${limit}&filter_type=CASH&filter_amount=${minCash}`;
  const res = await getJson(url);
  return res?.data || [];
}

// Full history for one wallet, newest first. Stops at maxTrades.
export async function fetchWalletTrades(wallet, maxTrades) {
  const rows = [];
  let cursor = null;
  let capped = false;
  for (;;) {
    const params = new URLSearchParams({ user: wallet, start: '1', limit: '1000', taker_only: 'false' });
    if (cursor) params.set('cursor', cursor);
    const res = await getJson(`${config.dataApi}/v2/trades?${params}`);
    const page = res?.data || [];
    rows.push(...page);
    cursor = res?.pagination?.next_cursor || null;
    if (!cursor || !res?.pagination?.has_more || page.length === 0) break;
    if (rows.length >= maxTrades) {
      capped = true;
      break;
    }
  }
  return { rows, capped };
}

// ---- Gamma (market metadata + resolution) -------------------------------------

const parseMaybeJson = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};

export function parseMarket(m) {
  const prices = parseMaybeJson(m.outcomePrices).map(Number);
  let status = 'open';
  let winningIndex = null;
  if (m.closed && prices.length) {
    const max = Math.max(...prices);
    if (max >= 0.99) {
      status = 'resolved';
      winningIndex = prices.indexOf(max);
    } else if (prices.every((p) => Math.abs(p - prices[0]) < 0.01)) {
      status = 'void'; // e.g. 50/50 refund resolution
    }
  }
  return {
    condition_id: String(m.conditionId || '').toLowerCase(),
    question: m.question ?? null,
    slug: m.slug ?? null,
    closed: !!m.closed,
    status,
    winning_index: winningIndex,
    fees_enabled: m.feesEnabled ?? null,
    token_ids: parseMaybeJson(m.clobTokenIds).map(String),
    end_date: m.endDate ?? null,
  };
}

export async function fetchMarkets(conditionIds) {
  const out = [];
  for (let i = 0; i < conditionIds.length; i += 50) {
    const chunk = conditionIds.slice(i, i + 50);
    const params = new URLSearchParams({ closed: 'any', limit: String(chunk.length) });
    for (const id of chunk) params.append('condition_ids', id);
    const res = await getJson(`${config.gammaApi}/markets?${params}`);
    const list = Array.isArray(res) ? res : res?.data || [];
    out.push(...list.map(parseMarket).filter((m) => m.condition_id));
  }
  return out;
}

// ---- CLOB order book ---------------------------------------------------------

// Average price paid if we spend `stakeUsd` taking the asks, best first.
export function vwapForStake(asks, stakeUsd) {
  const levels = (asks || [])
    .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
    .filter((l) => l.price > 0 && l.size > 0)
    .sort((a, b) => a.price - b.price);
  let spent = 0;
  let shares = 0;
  for (const { price, size } of levels) {
    const remaining = stakeUsd - spent;
    if (remaining <= 1e-9) break;
    const take = Math.min(size, remaining / price);
    spent += take * price;
    shares += take;
  }
  if (shares === 0) return { price: null, partial: true };
  return { price: spent / shares, partial: spent < stakeUsd - 1e-6 };
}

export async function fetchBook(tokenId) {
  return getJson(`${config.clobApi}/book?token_id=${encodeURIComponent(tokenId)}`, { tries: 2, timeoutMs: 5000 });
}
