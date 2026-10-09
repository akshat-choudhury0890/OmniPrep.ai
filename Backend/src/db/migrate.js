import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createDb } from './pool.js';
import { createLogger } from '../utils/logger.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
const LOCK_ID = 727274; // arbitrary app-wide advisory lock key

/** Applies migrations/*.sql in order, once each, serialised by an advisory lock. Safe to re-run. */
export async function runMigrations({ db, config, logger }) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    const sql = (await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8')).replaceAll('{{EMBEDDING_DIM}}', String(config.GEMINI_EMBEDDING_DIM));
    const ran = await db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]); // xact-level: pooler-safe
      const done = await c.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) return false;
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      return true;
    });
    if (ran) { applied.push(file); logger?.info({ file }, 'migration applied'); }
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const config = loadConfig();
    const logger = createLogger(config);
    const db = createDb({ connectionString: config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL, max: 2, logger });
    const applied = await runMigrations({ db, config, logger });
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date.');
    await db.close();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
