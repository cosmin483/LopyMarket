// fetch with timeout and polite retries on 429/5xx (honours Retry-After).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { method = 'GET', body, timeoutMs = 10000, tries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || attempt * 2;
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await sleep(Math.min(retryAfter, 30) * 1000);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.status && err.status < 500) throw err; // 4xx: retrying won't help
      if (attempt < tries) await sleep(attempt * 1000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
