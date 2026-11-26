import pg from 'pg';

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

const url = process.env.DATABASE_URL;
const ssl = url && !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url) ? { rejectUnauthorized: false } : undefined;

// Reuse one small pool across serverless invocations.
const pool = globalThis.__lopyPool || new pg.Pool({ connectionString: url, max: 3, ssl });
globalThis.__lopyPool = pool;

export async function q(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}
