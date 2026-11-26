# LopyMarket

Watches every Polymarket trade in real time, flags wallets that look like they trade on inside information, and **paper-trades** copying them, so you can see whether copying would actually make money before risking any.

Nothing here places real bets.

## How it works

```
Polymarket live feed (RTDS websocket) ─┐
Polymarket REST trade feed (every 15s) ─┴─► worker (Railway) ──► Postgres (Neon) ◄── dashboard (Vercel)
```

**Worker** (`src/worker`, always on):

1. Receives every trade over the live websocket within about a second. A REST poll runs alongside as a backup and to measure how much faster the websocket is.
2. Ignores trades under `MIN_TRADE_USD`.
3. **Early signal**: when someone buys a long shot (≤ 35¢ by default), the worker immediately pulls that wallet's whole history and scores the trade from 0 to 100 on size, price, wallet age, number of markets traded, how sensitive the topic is, and the wallet's past record. At or above `SIGNAL_THRESHOLD` it opens a paper bet.
4. **Track record**: every wallet that makes a big trade gets scored in the background. For each resolved position, the price the wallet paid is what the market thought its chance of winning was. From that the worker calculates the probability that a record this good is luck (a Poisson-binomial tail). Wallets at or below `SUSPECT_MAX_LOG10_P` (1 in 10,000 by default) with a profit are marked as suspects, and any later buy by a suspect is copied straight away.
5. **Realistic paper fills**: our bet is priced by walking the real order book for our stake at the moment we see the trade, not at the insider's price. The worker re-reads the book at +5s, +30s, +2min and +10min after the insider's trade, so the dashboard can show how profit decays with delay.
6. Settles bets when markets resolve.

**Dashboard** (`app/`, on Vercel): P&L by strategy, the cost of delay, detection latency, recent bets and suspect wallets.

## Setup (all in the browser)

### 1. Database: Neon (free)
1. Sign up at https://neon.tech and create a project (pick a US East region, close to Polymarket's servers).
2. Copy the connection string (`postgresql://…?sslmode=require`).

### 2. Worker: Railway (~$5/month)
1. Sign up at https://railway.com with GitHub.
2. **New Project → Deploy from GitHub repo → LopyMarket.**
3. In the service's **Variables** tab, add `DATABASE_URL` = your Neon connection string.
4. Railway reads `railway.json` and runs `npm run worker`. Its logs should show `database ready` and `RTDS connected`, then a summary line every minute.

### 3. Dashboard: Vercel (free)
1. At https://vercel.com, choose **Add New → Project → import LopyMarket**.
2. Under **Environment Variables**, add `DATABASE_URL` (same value) and `DASHBOARD_PASSWORD` (turns on the login screen).
3. Deploy.

## Updating
Both Railway and Vercel redeploy automatically on every push to `main`. If one doesn't:
- **Vercel:** Project → Deployments → the newest one → ⋯ → Redeploy.
- **Railway:** the service → Deployments → Deploy latest commit (or ⋯ → Redeploy).
Database changes apply automatically on start-up; there is nothing to run by hand.

## Settings (environment variables on Railway)

| Variable | Default | Meaning |
|---|---|---|
| `MIN_TRADE_USD` | 1000 | Ignore trades smaller than this |
| `SIGNAL_THRESHOLD` | 60 | Trade score (0–100) needed to open an early-signal bet |
| `LONGSHOT_MAX_PRICE` | 0.35 | Buys at or below this price get the instant wallet check |
| `FRESH_WALLET_DAYS` | 14 | Wallets younger than this count as fresh |
| `SUSPECT_MAX_LOG10_P` | -4 | Odds of luck needed to mark a suspect (-4 = 1 in 10,000) |
| `SUSPECT_MIN_RESOLVED` | 5 | Resolved positions needed before a wallet can be a suspect |
| `PAPER_STAKE_USD` | 10 | Size of each paper bet |
| `COPY_MAX_PRICE` | 0.9 | Never copy into outcomes priced above this |
| `TAKER_FEE_PCT` | 1 | Approximate fee charged on markets that have fees enabled |
| `MARK_DELAYS_SEC` | 5,30,120,600 | When to re-check the price after the insider's trade |
| `REST_POLL_MS` | 15000 | Backup REST poll interval |
| `SENSITIVE_KEYWORDS` | (list in `config.js`) | Topics where inside information is plausible |
| `EXCLUDE_SPORTS` | 1 | Skip sports/esports markets (in-play traders, not insiders). Set 0 to include them |
| `MAX_SIGNAL_AGE_SEC` | 90 | Never copy a trade older than this |
| `SUSPECT_MIN_EDGE` | 0.15 | Extra wins per bet needed for the watchlist; filters out sharp traders who win slightly more over hundreds of bets |
| `TRACK_RECORD_MAX_ENTRY` | 0.7 | Positions bought above this price don't count towards a track record |
| `START_BANKROLL` | 1000 | Paper bankroll the dashboard counts from |

## Caveats
- Trade timestamps are block times with 1-second resolution, so latency figures are accurate to about ±1s.
- The fee model is an approximation.
- With thousands of wallets scored, a few will look like insiders by luck. A suspect is a statistical outlier, not proof.
- Paper results ignore the risk of your account being restricted and the legal status of Polymarket where you live.

## Development
```
npm install
npm test                       # unit tests for scoring, parsing and fills
node test/mock-server.js       # fake Polymarket APIs on :4010 / ws :4011, for end-to-end runs
DATABASE_URL=… node test/seed-demo.js   # demo data for a SCRATCH database, to check the dashboard's look
```
