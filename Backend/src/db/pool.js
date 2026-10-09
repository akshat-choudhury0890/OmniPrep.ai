import pg from 'pg';
import { sleep } from '../utils/text.js';

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006',
]);

export function isTransientDbError(err) {
  return (
    TRANSIENT_CODES.has(err?.code) ||
    /Connection terminated|timeout expired|terminating connection|Client has encountered a connection error/i.test(err?.message ?? '')
  );
}

export function createDb({ connectionString, max = 10, logger }) {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000, // Neon suspends idle computes; don't hold dead sockets
    connectionTimeoutMillis: 10_000, // allows for a cold compute wake-up
    keepAlive: true,
    application_name: 'omniprep-api',
    ssl: {
      rejectUnauthorized: false, // Required for Neon SSL connection handling
    },
  });

  pool.on('error', (err) => logger?.warn({ err: { code: err.code, message: err.message } }, 'idle pg client error'));

  async function withRetry(fn, attempts = 3) {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i >= attempts || !isTransientDbError(err)) throw err;
        logger?.warn({ attempt: i, code: err.code }, 'transient database error, retrying');
        await sleep(250 * 3 ** (i - 1));
      }
    }
  }

  /** Single statement. Read-only statements are retried on transient connection errors. */
  function query(text, params, { retry } = {}) {
    const isRead = /^\s*(select|with)\b/i.test(text) && !/\b(insert|update|delete)\b/i.test(text);
    const run = () => pool.query(text, params);
    return retry ?? isRead ? withRetry(run) : run();
  }

  /** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on error. Connecting is retried, the body is not. */
  async function tx(fn) {
    const client = await withRetry(() => pool.connect());
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw err;
    } finally {
      client.release();
    }
  }

  return { pool, query, tx, close: () => pool.end() };
}

/** pgvector literal: '[0.1,0.2,...]' */
export const toVectorLiteral = (arr) => `[${arr.join(',')}]`;
