'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Mark from './Mark.js';

// ---------- formatting ---------------------------------------------------------

const money = (v, { signed = false, cents = true } = {}) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}$${abs}`;
};
const pct = (v, { signed = true, digits = 1 } = {}) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  const n = Number(v) * 100;
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
};
const price = (v) => (v === null || v === undefined ? '–' : `${(Number(v) * 100).toFixed(1)}¢`);
const secs = (ms) => {
  if (ms === null || ms === undefined) return '–';
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : s < 120 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`;
};
const ago = (ms, now) => {
  if (!ms) return '–';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const countdown = (ms) => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
};
const odds = (log10p) => {
  if (log10p === null || log10p === undefined) return '–';
  const n = Math.pow(10, -log10p);
  if (n < 1000) return `1 in ${Math.round(n)}`;
  if (n < 1e6) return `1 in ${Math.round(n / 1000)}k`;
  if (n < 1e9) return `1 in ${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  if (n < 1e12) return `1 in ${(n / 1e9).toFixed(n < 1e10 ? 1 : 0)}B`;
  return (
    <>
      1 in 10<sup>{Math.round(-log10p)}</sup>
    </>
  );
};
const tone = (v) => (v > 0.005 ? 'gain' : v < -0.005 ? 'loss' : '');
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const displayName = (name, address) => (name && !name.startsWith('0x') ? name : shortAddr(address));
const strategyName = (s) => (s === 'early' ? 'Early signal' : 'Watchlist copy');
const endTs = (b) => (b.end_date ? Date.parse(b.end_date) : null);

const useNow = (ms = 1000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
};

// ---------- the page -----------------------------------------------------------

export default function Dashboard({ initial, passwordProtected }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const now = useNow(1000);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (res.status === 401) return window.location.replace('/login');
      if (!res.ok) throw new Error();
      setData(await res.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 15000);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const { status, bankroll, series, openBets, settledBets, suspects, latency, delays, fills, strategies, counts } = data;
  const workerUp = status && now - status.updated_at < 90000;
  const liveFeed = status?.info?.rtds?.connected;
  const change = bankroll.equity - bankroll.start;

  const nextResult = useMemo(() => {
    const upcoming = openBets.map(endTs).filter((t) => t && t > now).sort((a, b) => a - b);
    return upcoming[0] || null;
  }, [openBets, now]);

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <Mark />
          <span>LopyMarket</span>
        </div>
        <div className="top-right">
          <span className={`status ${workerUp && liveFeed ? 'on' : 'off'}`} title={status ? `Worker heartbeat ${ago(status.updated_at, now)}` : 'No heartbeat yet'}>
            <i aria-hidden="true" />
            {!status ? 'Waiting for worker' : !workerUp ? 'Worker offline' : liveFeed ? 'Live' : 'Polling only'}
          </span>
          {stale && <span className="status off">Reconnecting</span>}
          {passwordProtected && (
            <form action="/api/logout" method="post">
              <button className="icon-btn" aria-label="Lock dashboard" title="Lock">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </header>

      <section className="hero" aria-labelledby="bankroll-label">
        <p id="bankroll-label" className="hero-label">Paper bankroll</p>
        <div className="hero-number">
          <Odometer text={money(bankroll.equity)} />
        </div>
        <p className={`hero-change ${tone(change)}`}>
          {money(change, { signed: true })} <span>({pct(change / bankroll.start)})</span>
          <span className="muted"> since the {money(bankroll.start, { cents: false })} start</span>
        </p>

        <dl className="hero-stats">
          <div>
            <dt>Locked in</dt>
            <dd className={tone(bankroll.realized)}>{money(bankroll.realized, { signed: true })}</dd>
          </div>
          <div>
            <dt>Open bets, if sold now</dt>
            <dd className={tone(bankroll.unrealized)}>{money(bankroll.unrealized, { signed: true })}</dd>
          </div>
          <div>
            <dt>Next result due</dt>
            <dd className="tabular">{nextResult ? countdown(nextResult - now) : bankroll.open ? 'Overdue' : '–'}</dd>
          </div>
        </dl>
      </section>

      <EquityChart series={series} start={bankroll.start} />

      <div className="columns">
        <div className="col">
          <Section title="Waiting for a result" count={openBets.length}>
            {openBets.length ? (
              <ul className="bets">
                {[...openBets]
                  .sort((a, b) => (endTs(a) ?? Infinity) - (endTs(b) ?? Infinity))
                  .map((b) => (
                    <OpenBet key={b.id} bet={b} now={now} />
                  ))}
              </ul>
            ) : (
              <Empty>
                No open bets. One opens when a trade scores {status?.info?.config?.signalThreshold ?? 60}+ or a watchlist wallet buys.
              </Empty>
            )}
          </Section>

          <Section title="Settled" count={settledBets.length}>
            {settledBets.length ? (
              <ul className="settled">
                {settledBets.map((b) => (
                  <li key={b.id}>
                    <span className={`result ${b.status}`}>
                      {b.status === 'won' ? 'Won' : b.status === 'lost' ? 'Lost' : 'Refunded'}
                    </span>
                    <span className="settled-title">
                      {b.title}
                      <small>{b.outcome} at {price(b.fill_price)}</small>
                    </span>
                    <span className={`settled-pnl ${tone(b.pnl)}`}>{money(b.pnl, { signed: true })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Results land here when markets resolve. Check the countdowns above.</Empty>
            )}
          </Section>
        </div>

        <div className="col">
          <Section title="What being late costs">
            <DelayChart delays={delays} fills={fills} />
          </Section>

          <Section title="Watchlist" count={suspects.length}>
            {suspects.length ? (
              <ul className="watch">
                {suspects.map((w) => (
                  <li key={w.address}>
                    <a href={`https://polymarket.com/profile/${w.address}`} target="_blank" rel="noreferrer" className="watch-name">
                      {displayName(w.name, w.address)}
                    </a>
                    <span className="watch-odds">{odds(w.log10_p)}</span>
                    <span className="watch-line">
                      Won {w.wins} of {w.n_resolved} long shots. Luck would explain about {Math.max(1, Math.round(w.expected_wins))}.
                    </span>
                    <span className={`watch-pnl ${tone(w.pnl_resolved)}`}>{money(w.pnl_resolved, { signed: true, cents: false })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                No wallets on the watchlist yet. A wallet joins when its long-shot record has less than a 1-in-10,000 chance of being luck, which takes days of resolved bets.
              </Empty>
            )}
          </Section>

          <Section title="Speed">
            <dl className="speed">
              <SpeedRow label="Live feed sees a trade" l={latency.live} />
              <SpeedRow label="Backup poll sees it" l={latency.rest} />
              <SpeedRow label="We place our paper bet" l={latency.fill} />
            </dl>
            <p className="footnote">Median time after the trade hit the blockchain. Block times are whole seconds, so expect ±1s.</p>
          </Section>

          <Section title="Coverage">
            <dl className="coverage">
              <div><dt>Big trades seen</dt><dd>{Number(counts.trades).toLocaleString()}</dd></div>
              <div><dt>Wallets checked</dt><dd>{Number(counts.wallets).toLocaleString()}</dd></div>
              <div><dt>Bets placed</dt><dd>{strategies.reduce((a, s) => a + Number(s.bets), 0)}</dd></div>
            </dl>
          </Section>
        </div>
      </div>

      <footer className="foot">
        Paper money only. A watchlist wallet is a statistical outlier, not proof of insider trading.
      </footer>
    </main>
  );
}

// ---------- pieces -------------------------------------------------------------

function Section({ title, count, children }) {
  return (
    <section className="section">
      <h2>
        {title}
        {count > 0 && <span className="count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }) => <p className="empty">{children}</p>;

// Rolling digits. Each digit is a reel that slides to its value; keys count from
// the right so a digit keeps its reel as the number grows.
function Odometer({ text }) {
  const chars = [...text];
  return (
    <span className="odo" aria-label={text} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <Digit key={key} d={Number(ch)} delay={i * 45} />
        ) : (
          <span key={`s${key}`} className="odo-sym" aria-hidden="true">{ch}</span>
        );
      })}
    </span>
  );
}

function Digit({ d, delay }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(d));
    return () => cancelAnimationFrame(id);
  }, [d]);
  return (
    <span className="odo-digit" aria-hidden="true">
      <span className="odo-reel" style={{ transform: `translateY(${-shown * 10}%)`, transitionDelay: `${delay}ms` }}>
        {'0123456789'.split('').map((n) => <span key={n}>{n}</span>)}
      </span>
    </span>
  );
}

function OpenBet({ bet, now }) {
  const end = endTs(bet);
  const remaining = end ? end - now : null;
  const total = end ? end - bet.filled_at : null;
  const progress = total > 0 ? Math.min(1, Math.max(0, (now - bet.filled_at) / total)) : null;
  const shares = bet.stake / bet.fill_price;
  const value = bet.current_bid !== null && bet.current_bid !== undefined ? shares * bet.current_bid : null;
  const pnl = value !== null ? value - bet.stake - bet.fee : null;

  return (
    <li className="bet">
      <div className="bet-head">
        <span className={`tag ${bet.strategy}`}>{strategyName(bet.strategy)}</span>
        <span className={`bet-pnl ${tone(pnl)}`} title="If sold at the best bid right now">
          {pnl === null ? 'Not priced yet' : money(pnl, { signed: true })}
        </span>
      </div>
      <p className="bet-title">{bet.title}</p>
      <p className="bet-pick">
        Backing <strong>{bet.outcome || 'outcome'}</strong>
      </p>
      <div className="ladder">
        <div><span>Insider paid</span><b>{price(bet.insider_price)}</b></div>
        <div><span>We paid</span><b>{price(bet.fill_price)}</b></div>
        <div><span>Now</span><b>{price(bet.current_bid)}</b></div>
      </div>
      <div className="clock">
        <div className="bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress ?? 0})` }} />
        </div>
        <span className="tabular">
          {remaining === null ? 'No end date published' : remaining > 0 ? `Result in ${countdown(remaining)}` : 'Waiting on the official result'}
        </span>
      </div>
      <p className="bet-meta">
        Copied{' '}
        <a href={`https://polymarket.com/profile/${bet.wallet}`} target="_blank" rel="noreferrer">
          {displayName(bet.name, bet.wallet)}
        </a>{' '}
        {secs(bet.filled_at - bet.trade_ts)} after their trade
      </p>
    </li>
  );
}

function SpeedRow({ label, l }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <b className="tabular">{l ? secs(l.p50) : '–'}</b>
        {l && <small>90% within {secs(l.p90)}</small>}
      </dd>
    </div>
  );
}

// How much more than the insider we'd pay at each delay, and what it did to returns.
function DelayChart({ delays, fills }) {
  const rows = [];
  if (fills?.n > 0) {
    rows.push({ key: 'ins', label: 'Insider', drift: 0, roi: fills.staked_insider ? fills.pnl_insider / fills.staked_insider : null });
    rows.push({ key: 'us', label: `Our fill, ${secs(fills.latency)}`, drift: fills.drift, roi: fills.staked ? fills.pnl / fills.staked : null });
  }
  for (const d of delays) {
    rows.push({ key: d.delay_sec, label: `After ${d.delay_sec < 60 ? `${d.delay_sec}s` : `${d.delay_sec / 60}m`}`, drift: d.drift, roi: d.staked ? d.pnl / d.staked : null });
  }
  if (!rows.length) return <Empty>Fills in once there are paper bets. Each one is re-priced 5s, 30s, 2m and 10m after the insider&apos;s trade.</Empty>;
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(r.drift || 0)));

  return (
    <div className="delay">
      <div className="delay-head" aria-hidden="true">
        <span />
        <span>Price paid vs insider</span>
        <span>Return so far</span>
      </div>
      {rows.map((r) => (
        <div className="delay-row" key={r.key}>
          <span className="delay-label">{r.label}</span>
          <span className="delay-bar">
            <span className="track">
              <span className="fill" style={{ width: `${(Math.max(0, r.drift || 0) / max) * 100}%` }} />
            </span>
            <span className="tabular">{r.drift === null ? '–' : pct(r.drift)}</span>
          </span>
          <span className={`delay-roi tabular ${tone(r.roi)}`}>{r.roi === null ? 'pending' : pct(r.roi)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- bankroll chart -------------------------------------------------------

const RANGES = [
  { key: '24h', ms: 86400000 },
  { key: '7d', ms: 7 * 86400000 },
  { key: 'All', ms: Infinity },
];

function EquityChart({ series, start }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState('7d');
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => {
    const ms = RANGES.find((r) => r.key === range).ms;
    const last = series.length ? series[series.length - 1].t : Date.now();
    return series.filter((p) => p.t >= last - ms);
  }, [series, range]);

  const height = width < 560 ? 160 : 200;
  const pad = { top: 14, right: 8, bottom: 24, left: 8 };
  const enough = pts.length >= 2 && width > 0;

  const geo = useMemo(() => {
    if (!enough) return null;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const vals = pts.map((p) => p.v).concat(start);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const span = Math.max(hi - lo, start * 0.01);
    lo -= span * 0.15;
    hi += span * 0.15;
    const x = (t) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.left - pad.right);
    const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${line}L${x(t1).toFixed(1)},${height - pad.bottom}L${x(t0).toFixed(1)},${height - pad.bottom}Z`;
    const ticks = [0, 0.5, 1].map((f) => t0 + f * (t1 - t0));
    return { x, y, line, area, ticks, t0, t1 };
  }, [pts, width, height, start, enough]);

  const onMove = (e) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(geo.x(p.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const fmtTick = (t) => {
    const d = new Date(t);
    return geo && geo.t1 - geo.t0 < 2 * 86400000
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const hp = hover !== null && pts[hover];

  return (
    <section className="chart" aria-label="Paper bankroll over time">
      <div className="seg" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.key} role="tab" aria-selected={range === r.key} onClick={() => setRange(r.key)}>
            {r.key}
          </button>
        ))}
      </div>
      <div className="chart-box" ref={wrap} style={{ height }}>
        {geo ? (
          <svg
            width={width}
            height={height}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Bankroll from ${money(pts[0].v)} to ${money(pts[pts.length - 1].v)}`}
          >
            <defs>
              <linearGradient id="eqfill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--amber)" stopOpacity=".28" />
                <stop offset="1" stopColor="var(--amber)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1={pad.left} x2={width - pad.right} y1={geo.y(start)} y2={geo.y(start)} className="baseline" />
            <text x={width - pad.right} y={geo.y(start) - 6} textAnchor="end" className="axis-label">
              Start {money(start, { cents: false })}
            </text>
            <path d={geo.area} fill="url(#eqfill)" />
            <path d={geo.line} className="eqline" />
            {geo.ticks.map((t, i) => (
              <text key={i} x={geo.x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="axis-label">
                {fmtTick(t)}
              </text>
            ))}
            {hp && (
              <g>
                <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={pad.top} y2={height - pad.bottom} className="crosshair" />
                <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r="5" className="dot" />
              </g>
            )}
          </svg>
        ) : (
          <p className="empty chart-empty">The line starts once there are a few snapshots. One is taken every 5 minutes.</p>
        )}
        {hp && geo && (
          <div
            className="tip"
            style={{ left: Math.min(Math.max(geo.x(hp.t), 70), width - 70), top: Math.max(geo.y(hp.v) - 54, 0) }}
          >
            <b>{money(hp.v)}</b>
            <span>{new Date(hp.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
      </div>
    </section>
  );
}
