import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// BIGINT columns hold millisecond timestamps, which fit safely in a JS number.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const needsSsl = (url) => url && !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  ssl: needsSsl(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

export const query = (text, params) => pool.query(text, params);

export async function migrate() {
  const sql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  await pool.query(sql);
}
