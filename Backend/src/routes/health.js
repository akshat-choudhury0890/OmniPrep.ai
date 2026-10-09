import { Router } from 'express';
import { inspectDatabase } from '../db/checks.js';

export function healthRouter({ db, storage, config }) {
  const r = Router();
  r.get('/', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  r.get('/ready', async (req, res) => {
    const checks = { database: 'down', pgvector: null, storage: 'down' };
    try {
      const info = await inspectDatabase(db);
      checks.database = 'up';
      checks.pgvector = info.pgvectorVersion;
      checks.embedding = { model: config.GEMINI_EMBEDDING_MODEL, dimensions: config.GEMINI_EMBEDDING_DIM, columnDimensions: info.columnDim };
    } catch { /* reported as down */ }
    try { await storage.ping(); checks.storage = 'up'; } catch { /* reported as down */ }
    const ok = checks.database === 'up' && checks.pgvector && checks.storage === 'up';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks });
  });
  return r;
}
