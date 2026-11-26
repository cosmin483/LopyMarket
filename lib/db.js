import pg from 'pg';
import { SCHEMA_SQL } from '../src/worker/schema.js';

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

const url = process.env.DATABASE_URL;
const ssl = url && !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url) ? { rejectUnauthorized: false } : undefined;

// Reuse one small pool across serverless invocations.
const pool = globalThis.__lopyPool || new pg.Pool({ connectionString: url, max: 3, ssl });
globalThis.__lopyPool = pool;

// The dashboard may deploy before the worker restarts, so it applies the
// (idempotent) schema itself once per cold start.
let ready = globalThis.__lopyReady;
function ensureSchema() {
  if (!ready) {
    ready = pool.query(SCHEMA_SQL).catch((e) => {
      ready = null;
      throw e;
    });
    globalThis.__lopyReady = ready;
  }
  return ready;
}

export async function q(text, params) {
  await ensureSchema();
  const { rows } = await pool.query(text, params);
  return rows;
}
