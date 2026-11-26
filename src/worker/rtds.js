// Live trade stream from Polymarket's Real-Time Data Socket, with heartbeat and
// a watchdog: the stream is known to sometimes go silent while the socket stays
// open, so we reconnect whenever no message arrives for a while.
import WebSocket from 'ws';
import { config } from './config.js';
import { log } from './log.js';

export const rtdsState = { connected: false, lastMessageAt: null, reconnects: 0, messages: 0 };

export function startRtds(onTrade, { silenceMs = 45000, pingMs = 5000 } = {}) {
  let ws;
  let pingTimer;
  let watchdog;
  let backoff = 1000;
  let stopped = false;

  const cleanup = () => {
    clearInterval(pingTimer);
    clearInterval(watchdog);
    rtdsState.connected = false;
  };

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(config.rtdsUrl);

    ws.on('open', () => {
      rtdsState.connected = true;
      rtdsState.lastMessageAt = Date.now();
      backoff = 1000;
      log('RTDS connected');
      ws.send(JSON.stringify({ action: 'subscribe', subscriptions: [{ topic: 'activity', type: 'trades' }] }));
      pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), pingMs);
      watchdog = setInterval(() => {
        if (Date.now() - rtdsState.lastMessageAt > silenceMs) {
          log('RTDS silent, reconnecting');
          ws.terminate();
        }
      }, 5000);
    });

    ws.on('message', (data) => {
      const receivedAt = Date.now();
      rtdsState.lastMessageAt = receivedAt;
      const text = data.toString();
      if (!text || text[0] !== '{') return; // pong / keepalive
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.topic !== 'activity' || !msg.payload) return;
      rtdsState.messages++;
      const payloads = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
      for (const p of payloads) onTrade(p, receivedAt);
    });

    ws.on('close', () => {
      cleanup();
      if (stopped) return;
      rtdsState.reconnects++;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    });

    ws.on('error', (err) => log(`RTDS error: ${err.message}`));
  };

  connect();
  return () => {
    stopped = true;
    cleanup();
    ws?.terminate();
  };
}
