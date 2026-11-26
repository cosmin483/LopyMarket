// Every trade from the live feed or the REST poll flows through handleTrade().
import { config } from './config.js';
import { query } from './db.js';
import { scoreTrade } from './scoring.js';
import { getWallet, ensureWalletScored, queueWallet } from './wallets.js';
import { openBet } from './paper.js';
import { getMarkets } from './markets.js';
import { looksLikeSports } from './polymarket.js';
import { log } from './log.js';

export const stats = { seen: 0, stored: 0, signals: 0, bets: 0, errors: 0 };

const DAY = 86400000;

async function storeTrade(t) {
  const now = t.received_at;
  const { rows } = await query(
    `INSERT INTO trades (id, tx_hash, wallet, condition_id, token_id, side, outcome, outcome_index, price, size, cash,
       title, slug, event_slug, trade_ts, received_at, source, rtds_seen_at, rest_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET
       rtds_seen_at = COALESCE(trades.rtds_seen_at, EXCLUDED.rtds_seen_at),
       rest_seen_at = COALESCE(trades.rest_seen_at, EXCLUDED.rest_seen_at)
     RETURNING (xmax = 0) AS inserted`,
    [
      t.id, t.tx_hash, t.wallet, t.condition_id, t.token_id, t.side, t.outcome, t.outcome_index, t.price, t.size, t.cash,
      t.title, t.slug, t.event_slug, t.trade_ts, now, t.source,
      t.source === 'rtds' ? now : null, t.source === 'rest' ? now : null,
    ]
  );
  return rows[0].inserted;
}

async function createSignal(trade, strategy, score, reasons) {
  const { rows } = await query(
    `INSERT INTO signals (trade_id, wallet, strategy, score, reasons, created_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (trade_id, strategy) DO NOTHING RETURNING id, strategy`,
    [trade.id, trade.wallet, strategy, score, JSON.stringify(reasons), Date.now()]
  );
  if (rows[0]) stats.signals++;
  return rows[0] || null;
}

async function act(trade, strategy, score, reasons) {
  const signal = await createSignal(trade, strategy, score, reasons);
  if (!signal) return;
  const betId = await openBet(trade, signal);
  if (betId) stats.bets++;
}

async function isSports(trade) {
  if (looksLikeSports(trade.title)) return true;
  try {
    const m = (await getMarkets([trade.condition_id])).get(trade.condition_id);
    return !!m?.is_sports;
  } catch {
    return false;
  }
}

export async function handleTrade(trade) {
  if (!trade) return;
  stats.seen++;
  if (trade.cash < config.minTradeUsd) return;
  try {
    const inserted = await storeTrade(trade);
    if (!inserted) return; // already handled when the other feed delivered it
    stats.stored++;

    const tooOld = trade.received_at - trade.trade_ts > config.maxSignalAgeSec * 1000;
    const copyable =
      trade.side === 'BUY' &&
      trade.price <= config.copyMaxPrice &&
      trade.outcome_index !== null && // combos/parlays have no single outcome to copy
      !tooOld;
    if (!copyable || (config.excludeSports && (await isSports(trade)))) {
      queueWallet(trade.wallet);
      return;
    }

    // Fast path: a known suspect is buying. Copy immediately, no extra API calls.
    let wallet = await getWallet(trade.wallet);
    if (wallet?.suspect) {
      await act(trade, 'suspect', null, [`known suspect: odds 1e${wallet.log10_p?.toFixed(1)}`]);
    }

    // Early-warning path: big long shots get the wallet looked up right now.
    if (trade.price <= config.longshotMaxPrice) {
      const young = !wallet || (!wallet.history_capped && (!wallet.first_trade_ts || Date.now() - wallet.first_trade_ts < config.freshWalletDays * DAY));
      wallet = await ensureWalletScored(trade.wallet, { force: young });
      // The history API can lag the live feed, so this trade may be missing from it.
      const view = wallet && {
        ...wallet,
        first_trade_ts: wallet.history_capped ? null : Math.min(wallet.first_trade_ts ?? trade.trade_ts, trade.trade_ts),
        n_markets: Math.max(wallet.n_markets ?? 0, 1),
      };
      const { score, reasons } = scoreTrade(trade, view, config);
      if (score >= config.signalThreshold) await act(trade, 'early', score, reasons);
      if (wallet?.suspect) {
        // Freshly discovered suspect (duplicates are ignored by the unique key).
        await act(trade, 'suspect', null, [`known suspect: odds 1e${wallet.log10_p?.toFixed(1)}`]);
      }
    } else {
      queueWallet(trade.wallet);
    }
  } catch (e) {
    stats.errors++;
    log(`handleTrade error: ${e.message}`);
  }
}
