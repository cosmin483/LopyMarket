-- Applied automatically by the worker on start. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY,           -- tx hash + token + wallet + side + size + price
  tx_hash       TEXT,
  wallet        TEXT NOT NULL,
  condition_id  TEXT NOT NULL,
  token_id      TEXT NOT NULL,
  side          TEXT NOT NULL,              -- BUY / SELL
  outcome       TEXT,
  outcome_index INT,
  price         DOUBLE PRECISION NOT NULL,
  size          DOUBLE PRECISION NOT NULL,  -- shares
  cash          DOUBLE PRECISION NOT NULL,  -- USDC
  title         TEXT,
  slug          TEXT,
  event_slug    TEXT,
  trade_ts      BIGINT NOT NULL,            -- block time, ms
  received_at   BIGINT NOT NULL,            -- when we first saw it, ms
  source        TEXT NOT NULL,              -- 'rtds' or 'rest' (whichever saw it first)
  rtds_seen_at  BIGINT,
  rest_seen_at  BIGINT
);
CREATE INDEX IF NOT EXISTS trades_wallet_idx ON trades (wallet);
CREATE INDEX IF NOT EXISTS trades_ts_idx ON trades (trade_ts DESC);

CREATE TABLE IF NOT EXISTS markets (
  condition_id   TEXT PRIMARY KEY,
  question       TEXT,
  slug           TEXT,
  closed         BOOLEAN,
  status         TEXT NOT NULL DEFAULT 'open', -- open / resolved / void
  winning_index  INT,
  fees_enabled   BOOLEAN,
  token_ids      JSONB,
  end_date       TEXT,
  fetched_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  address         TEXT PRIMARY KEY,
  first_trade_ts  BIGINT,          -- ms; null if unknown
  history_capped  BOOLEAN,         -- true if we stopped paging (very active wallet, so not fresh)
  n_trades        INT,
  n_markets       INT,
  n_resolved      INT,             -- resolved positions counted in the track record
  wins            INT,
  expected_wins   DOUBLE PRECISION,
  z_score         DOUBLE PRECISION,
  log10_p         DOUBLE PRECISION, -- log10 of chance a record this good is luck
  cost_resolved   DOUBLE PRECISION,
  pnl_resolved    DOUBLE PRECISION,
  suspect         BOOLEAN NOT NULL DEFAULT FALSE,
  name            TEXT,
  scored_at       BIGINT
);
CREATE INDEX IF NOT EXISTS wallets_suspect_idx ON wallets (suspect) WHERE suspect;

CREATE TABLE IF NOT EXISTS signals (
  id            BIGSERIAL PRIMARY KEY,
  trade_id      TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  wallet        TEXT NOT NULL,
  strategy      TEXT NOT NULL,     -- 'early' (trade score) or 'suspect' (copy known suspect)
  score         DOUBLE PRECISION,
  reasons       JSONB,
  created_at    BIGINT NOT NULL,
  UNIQUE (trade_id, strategy)
);

CREATE TABLE IF NOT EXISTS paper_bets (
  id             BIGSERIAL PRIMARY KEY,
  signal_id      BIGINT REFERENCES signals(id) ON DELETE SET NULL,
  strategy       TEXT NOT NULL,
  wallet         TEXT NOT NULL,
  condition_id   TEXT NOT NULL,
  token_id       TEXT NOT NULL,
  outcome        TEXT,
  outcome_index  INT,
  title          TEXT,
  insider_price  DOUBLE PRECISION NOT NULL,
  trade_ts       BIGINT NOT NULL,   -- insider's block time, ms
  detected_at    BIGINT NOT NULL,   -- we saw the trade, ms
  filled_at      BIGINT NOT NULL,   -- we read the order book, ms
  fill_price     DOUBLE PRECISION,  -- VWAP for our stake walking the asks; null if no book
  fill_source    TEXT,              -- 'book' / 'book_partial' / 'none'
  stake          DOUBLE PRECISION NOT NULL,
  fee            DOUBLE PRECISION NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open', -- open / won / lost / void / unfillable
  pnl            DOUBLE PRECISION,
  resolved_at    BIGINT,
  UNIQUE (strategy, wallet, token_id)
);
CREATE INDEX IF NOT EXISTS paper_bets_status_idx ON paper_bets (status);

-- Price we could have got if we had acted N seconds after the insider's block time.
CREATE TABLE IF NOT EXISTS paper_bet_marks (
  bet_id      BIGINT NOT NULL REFERENCES paper_bets(id) ON DELETE CASCADE,
  delay_sec   INT NOT NULL,
  price       DOUBLE PRECISION,  -- VWAP for the stake; null if no liquidity
  fetched_at  BIGINT NOT NULL,
  PRIMARY KEY (bet_id, delay_sec)
);

CREATE TABLE IF NOT EXISTS worker_status (
  id          INT PRIMARY KEY DEFAULT 1,
  updated_at  BIGINT NOT NULL,
  started_at  BIGINT NOT NULL,
  info        JSONB
);
