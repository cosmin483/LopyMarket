'use client';

import { useState, useRef } from 'react';
import Mark from '../Mark.js';

export default function Login() {
  const [password, setPassword] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | wrong | error
  const [shake, setShake] = useState(0);
  const input = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!password || state === 'busy') return;
    setState('busy');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.replace('/');
        return;
      }
      setState(res.status === 401 ? 'wrong' : 'error');
    } catch {
      setState('error');
    }
    setShake((n) => n + 1);
    setPassword('');
    input.current?.focus();
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit} key={shake} data-shake={shake > 0 || undefined}>
        <div className="login-brand">
          <Mark size={44} />
          <h1>LopyMarket</h1>
        </div>
        <p className="login-lede">Tracking the wallets that seem to know first.</p>

        <label htmlFor="pw" className="login-label">Password</label>
        <input
          id="pw"
          ref={input}
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (state !== 'busy') setState('idle');
          }}
          aria-invalid={state === 'wrong'}
          aria-describedby="pw-msg"
        />
        <p id="pw-msg" className="login-msg" role="status">
          {state === 'wrong' && "That password didn't work. Try again."}
          {state === 'error' && "Couldn't reach the server. Check your connection and try again."}
        </p>
        <button type="submit" disabled={!password || state === 'busy'}>
          {state === 'busy' ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
