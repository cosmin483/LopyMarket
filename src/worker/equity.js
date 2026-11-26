// Paper bankroll maths, shared by the worker (snapshots) and the dashboard (live value).
// Open bets are valued at the best bid: what we could sell them for right now.
export const EQUITY_SQL = `
  SELECT
    coalesce(sum(pnl) FILTER (WHERE status IN ('won','lost','void')), 0) AS realized,
    coalesce(sum(CASE WHEN status = 'open'
      THEN coalesce(current_bid, fill_price) * stake / fill_price - stake - fee END), 0) AS unrealized,
    count(*) FILTER (WHERE status = 'open') AS open_count
  FROM paper_bets`;
