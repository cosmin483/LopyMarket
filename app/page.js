import { q } from '../lib/db.js';

export const dynamic = 'force-dynamic';

const usd = (v, signed = false) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return `${v < 0 ? '-' : signed && v > 0 ? '+' : ''}$${s}`;
};
const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
const secs = (ms) => (ms === null || ms === undefined ? '–' : ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);
const ago = (ms) => {
  if (!ms) return '–';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const cls = (v) => (v > 0 ? 'good' : v < 0 ? 'bad' : '');
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const Wallet = ({ address, name }) => (
  <a href={`https://polymarket.com/profile/${address}`} target="_blank" rel="noreferrer">
    {name && !name.startsWith('0x') ? name : short(address)}
  </a>
);

async function load() {
  const now = Date.now();
  const [status] = await q('SELECT * FROM worker_status WHERE id = 1');
  const strategies = await q(`
    SELECT strategy,
      count(*) FILTER (WHERE status <> 'unfillable') AS bets,
      count(*) FILTER (WHERE status = 'open') AS open,
      count(*) FILTER (WHERE status IN ('won','lost')) AS settled,
      count(*) FILTER (WHERE status = 'won') AS won,
      count(*) FILTER (WHERE status = 'unfillable') AS unfillable,
      coalesce(sum(stake) FILTER (WHERE status IN ('won','lost')), 0) AS staked,
      coalesce(sum(pnl) FILTER (WHERE status IN ('won','lost','void')), 0) AS pnl,
      coalesce(sum(CASE WHEN status = 'won' THEN stake / insider_price - stake - fee
                        WHEN status = 'lost' THEN -stake - fee ELSE 0 END), 0) AS pnl_insider
    FROM paper_bets GROUP BY strategy ORDER BY strategy`);
  const delays = await q(`
    SELECT m.delay_sec,
      count(*) AS n_all,
      avg(m.price / b.insider_price - 1) AS drift,
      count(*) FILTER (WHERE b.status IN ('won','lost')) AS n_settled,
      sum(CASE WHEN b.status = 'won' THEN b.stake / m.price - b.stake - b.fee
               WHEN b.status = 'lost' THEN -b.stake - b.fee END) AS pnl,
      sum(b.stake) FILTER (WHERE b.status IN ('won','lost')) AS staked
    FROM paper_bets b JOIN paper_bet_marks m ON m.bet_id = b.id
    WHERE m.price IS NOT NULL AND b.status <> 'unfillable'
    GROUP BY m.delay_sec ORDER BY m.delay_sec`);
  const latency = await q(
    `SELECT k, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY lat) AS p90
     FROM (
       SELECT 'Live feed (RTDS)' AS k, rtds_seen_at - trade_ts AS lat FROM trades WHERE rtds_seen_at IS NOT NULL AND trade_ts > $1
       UNION ALL
       SELECT 'REST poll', rest_seen_at - trade_ts FROM trades WHERE rest_seen_at IS NOT NULL AND trade_ts > $1
       UNION ALL
       SELECT 'Paper bet filled', filled_at - trade_ts FROM paper_bets WHERE trade_ts > $2
     ) x GROUP BY k ORDER BY k`,
    [now - 86400000, now - 7 * 86400000]
  );
  const bets = await q(`
    SELECT b.*, w.name,
      (SELECT json_object_agg(m.delay_sec, m.price) FROM paper_bet_marks m WHERE m.bet_id = b.id) AS marks
    FROM paper_bets b LEFT JOIN wallets w ON w.address = b.wallet
    ORDER BY b.detected_at DESC LIMIT 60`);
  const suspects = await q(`
    SELECT w.*, (SELECT max(trade_ts) FROM trades t WHERE t.wallet = w.address) AS last_trade
    FROM wallets w WHERE suspect ORDER BY log10_p ASC LIMIT 60`);
  const [counts] = await q(`
    SELECT (SELECT count(*) FROM trades) AS trades, (SELECT count(*) FROM wallets) AS wallets,
           (SELECT count(*) FROM wallets WHERE suspect) AS suspects, (SELECT count(*) FROM signals) AS signals`);
  return { status, strategies, delays, latency, bets, suspects, counts };
}

export default async function Page() {
  let data;
  try {
    data = await load();
  } catch (e) {
    return (
      <main>
        <h1>LopyMarket</h1>
        <p className="note-box">
          No data yet ({e.message}). Check that DATABASE_URL is set in Vercel and that the worker has started at least once.
        </p>
      </main>
    );
  }
  const { status, strategies, delays, latency, bets, suspects, counts } = data;
  const info = status?.info || {};
  const workerUp = status && Date.now() - status.updated_at < 90000;
  const delayCols = [...new Set(bets.flatMap((b) => Object.keys(b.marks || {})))].map(Number).sort((a, b) => a - b);

  return (
    <main>
      <h1>LopyMarket</h1>
      <p className="sub">
        Worker <span className={workerUp ? 'good' : 'bad'}>{workerUp ? 'running' : 'not reporting'}</span>
        {status && <> · heartbeat {ago(status.updated_at)} · up since {new Date(status.started_at).toLocaleString('en-GB')}</>}
        {' · '}live feed <span className={info.rtds?.connected ? 'good' : 'bad'}>{info.rtds?.connected ? 'connected' : 'down'}</span>
        {' · '}page refreshes every 30s
      </p>

      <div className="tiles">
        <Tile label="Trades stored" value={counts.trades.toLocaleString()} note={`≥ $${info.config?.minTradeUsd ?? '?'} each`} />
        <Tile label="Wallets scored" value={counts.wallets.toLocaleString()} note={`${info.walletQueue ?? 0} in queue`} />
        <Tile label="Suspect wallets" value={counts.suspects.toLocaleString()} />
        <Tile label="Signals" value={counts.signals.toLocaleString()} />
      </div>

      <h2>Paper P&amp;L by strategy</h2>
      <div className="wrap">
        {strategies.length ? (
          <table>
            <thead>
              <tr>
                <th>Strategy</th><th className="num">Bets</th><th className="num">Open</th><th className="num">Settled</th>
                <th className="num">Win rate</th><th className="num">Staked (settled)</th><th className="num">P&amp;L (our fills)</th>
                <th className="num">ROI</th><th className="num">P&amp;L at insider&apos;s price</th><th className="num">Unfillable</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr key={s.strategy}>
                  <td>{s.strategy === 'early' ? 'Early signal (trade score)' : 'Copy known suspects'}</td>
                  <td className="num">{s.bets}</td><td className="num">{s.open}</td><td className="num">{s.settled}</td>
                  <td className="num">{s.settled ? pct(s.won / s.settled) : '–'}</td>
                  <td className="num">{usd(s.staked)}</td>
                  <td className={`num ${cls(s.pnl)}`}>{usd(s.pnl, true)}</td>
                  <td className={`num ${cls(s.pnl)}`}>{s.staked ? pct(s.pnl / s.staked) : '–'}</td>
                  <td className={`num ${cls(s.pnl_insider)}`}>{usd(s.pnl_insider, true)}</td>
                  <td className="num">{s.unfillable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No paper bets yet. They appear when a trade crosses the signal threshold.</div>
        )}
      </div>

      <h2>What delay costs</h2>
      <div className="wrap">
        {delays.length ? (
          <table>
            <thead>
              <tr>
                <th>If we bought N s after the insider</th><th className="num">Bets sampled</th>
                <th className="num">Avg price vs insider</th><th className="num">Settled</th>
                <th className="num">P&amp;L</th><th className="num">ROI</th>
              </tr>
            </thead>
            <tbody>
              {delays.map((d) => (
                <tr key={d.delay_sec}>
                  <td>{d.delay_sec}s</td><td className="num">{d.n_all}</td>
                  <td className={`num ${cls(-d.drift)}`}>{d.drift >= 0 ? '+' : ''}{pct(d.drift)}</td>
                  <td className="num">{d.n_settled}</td>
                  <td className={`num ${cls(d.pnl)}`}>{d.n_settled ? usd(d.pnl, true) : '–'}</td>
                  <td className={`num ${cls(d.pnl)}`}>{d.staked ? pct(d.pnl / d.staked) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No price samples yet.</div>
        )}
      </div>

      <h2>Detection latency</h2>
      <div className="tiles">
        {latency.length ? (
          latency.map((l) => (
            <Tile key={l.k} label={l.k} value={`${secs(l.p50)} median`} note={`p90 ${secs(l.p90)} · ${l.n} samples`} />
          ))
        ) : (
          <div className="tile"><div className="note">No trades yet.</div></div>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Measured from the trade&apos;s block time (1-second resolution) to when we saw it or read the order book.
      </p>

      <h2>Recent paper bets</h2>
      <div className="wrap">
        {bets.length ? (
          <table>
            <thead>
              <tr>
                <th>When</th><th>Strategy</th><th>Wallet</th><th>Market</th><th>Outcome</th>
                <th className="num">Insider</th><th className="num">Us</th><th className="num">Latency</th>
                {delayCols.map((d) => <th key={d} className="num">+{d}s</th>)}
                <th>Status</th><th className="num">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((b) => (
                <tr key={b.id}>
                  <td className="muted">{ago(b.detected_at)}</td>
                  <td><span className="pill">{b.strategy}</span></td>
                  <td><Wallet address={b.wallet} name={b.name} /></td>
                  <td className="title">{b.title}</td>
                  <td>{b.outcome}</td>
                  <td className="num">{b.insider_price.toFixed(3)}</td>
                  <td className="num">{b.fill_price?.toFixed(3) ?? '–'}</td>
                  <td className="num">{secs(b.filled_at - b.trade_ts)}</td>
                  {delayCols.map((d) => (
                    <td key={d} className="num muted">{b.marks?.[d] != null ? Number(b.marks[d]).toFixed(3) : '–'}</td>
                  ))}
                  <td className={b.status === 'won' ? 'good' : b.status === 'lost' ? 'bad' : 'muted'}>{b.status}</td>
                  <td className={`num ${cls(b.pnl)}`}>{b.pnl === null ? '–' : usd(b.pnl, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No paper bets yet.</div>
        )}
      </div>

      <h2>Suspect wallets</h2>
      <div className="wrap">
        {suspects.length ? (
          <table>
            <thead>
              <tr>
                <th>Wallet</th><th className="num">Wins / resolved</th><th className="num">Expected wins</th>
                <th className="num">Chance it&apos;s luck</th><th className="num">Realised P&amp;L</th><th className="num">Wallet age</th>
                <th className="num">Last big trade</th>
              </tr>
            </thead>
            <tbody>
              {suspects.map((w) => (
                <tr key={w.address}>
                  <td><Wallet address={w.address} name={w.name} /></td>
                  <td className="num">{w.wins} / {w.n_resolved}</td>
                  <td className="num">{w.expected_wins?.toFixed(1)}</td>
                  <td className="num">1 in {formatOdds(w.log10_p)}</td>
                  <td className={`num ${cls(w.pnl_resolved)}`}>{usd(w.pnl_resolved, true)}</td>
                  <td className="num">{w.first_trade_ts ? ago(w.first_trade_ts).replace(' ago', '') : 'old'}</td>
                  <td className="num muted">{ago(w.last_trade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No suspects yet. Wallets are scored as they make big trades, so this fills up over hours to days.</div>
        )}
      </div>

      <p className="sub" style={{ marginTop: 24 }}>
        A flagged wallet is a statistical outlier, not proof of insider trading. With thousands of wallets scored, some will look this good by luck.
      </p>
    </main>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function formatOdds(log10p) {
  if (log10p === null || log10p === undefined) return '–';
  const n = Math.pow(10, -log10p);
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  return `10^${Math.round(-log10p)}`;
}
