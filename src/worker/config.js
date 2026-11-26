// All tunables come from environment variables so they can be changed on the host
// (Railway, etc.) without touching code.

const num = (key, def) => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? Number(v) : def;
};
const list = (key, def) =>
  (process.env[key] || def)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  databaseUrl: process.env.DATABASE_URL,

  // API endpoints (overridable so tests can point at a mock server)
  dataApi: process.env.DATA_API_URL || 'https://data-api.polymarket.com',
  gammaApi: process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com',
  clobApi: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
  rtdsUrl: process.env.RTDS_URL || 'wss://ws-live-data.polymarket.com',
  enableRtds: process.env.ENABLE_RTDS !== '0',

  // Ingestion
  minTradeUsd: num('MIN_TRADE_USD', 1000), // trades smaller than this are ignored entirely
  restPollMs: num('REST_POLL_MS', 15000), // backup REST poll of the global trade feed
  tradeRetentionDays: num('TRADE_RETENTION_DAYS', 30),
  maxSignalAgeSec: num('MAX_SIGNAL_AGE_SEC', 90), // never act on trades older than this (e.g. start-up backlog)
  excludeSports: process.env.EXCLUDE_SPORTS !== '0', // live sports/esports long shots are mostly in-play traders, not insiders

  // Early-signal scoring of individual trades
  signalThreshold: num('SIGNAL_THRESHOLD', 60), // 0..100, a trade at/above this opens a paper bet
  longshotMaxPrice: num('LONGSHOT_MAX_PRICE', 0.35),
  freshWalletDays: num('FRESH_WALLET_DAYS', 14),
  sensitiveKeywords: list(
    'SENSITIVE_KEYWORDS',
    'strike,strikes,attack,military,invade,invasion,troops,ceasefire,war,missile,bomb,iran,israel,venezuela,' +
      'ukraine,russia,china,taiwan,pentagon,nato,sanction,indict,arrest,resign,fired,pardon,nominate,' +
      'announce,announcement,acquire,acquisition,merger,launch,release,ipo,fda,approval,award,winner'
  ),

  // Wallet track-record scoring
  scoreMinPositionUsd: num('SCORE_MIN_POSITION_USD', 20), // ignore dust positions in track records
  suspectMinResolved: num('SUSPECT_MIN_RESOLVED', 5),
  suspectMaxLog10P: num('SUSPECT_MAX_LOG10_P', -4), // record has <= 1-in-10,000 odds of being luck
  // Extra wins per bet above what the prices implied. Insiders win far more than expected on
  // each bet; sharp traders and favourite-grinders win only slightly more over hundreds of bets.
  suspectMinEdge: num('SUSPECT_MIN_EDGE', 0.15),
  trackRecordMaxEntry: num('TRACK_RECORD_MAX_ENTRY', 0.7), // ignore near-certain favourites in track records
  walletRescoreHours: num('WALLET_RESCORE_HOURS', 12),
  walletHistoryMaxTrades: num('WALLET_HISTORY_MAX_TRADES', 3000),
  walletQueueConcurrency: num('WALLET_QUEUE_CONCURRENCY', 2),

  // Paper trading
  stakeUsd: num('PAPER_STAKE_USD', 10),
  copyMaxPrice: num('COPY_MAX_PRICE', 0.9), // never copy into an outcome priced above this
  takerFeePct: num('TAKER_FEE_PCT', 1), // applied only on markets with fees enabled; approximation
  markDelaysSec: list('MARK_DELAYS_SEC', '5,30,120,600').map(Number),
  resolveEveryMs: num('RESOLVE_EVERY_MS', 5 * 60 * 1000),
  startBankroll: num('START_BANKROLL', 1000), // the paper bankroll the dashboard counts from
  priceRefreshMs: num('PRICE_REFRESH_MS', 60000), // re-value open bets
  equitySnapshotMs: num('EQUITY_SNAPSHOT_MS', 5 * 60 * 1000),
};
