// Usage: npm run reembed -- --yes
// Rebuilds ALL vectors after GEMINI_EMBEDDING_MODEL or GEMINI_EMBEDDING_DIM changed.
// Original files are re-read from storage, re-chunked and re-embedded; documents are 'processing' (hidden from search) meanwhile.
import { loadConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createDb } from '../db/pool.js';
import { inspectDatabase } from '../db/checks.js';
import { buildServices } from '../services/index.js';

const config = loadConfig();
if (!process.argv.includes('--yes')) {
  console.error(
    `This re-embeds every document with ${config.GEMINI_EMBEDDING_MODEL} (${config.GEMINI_EMBEDDING_DIM} dims) and may use significant API quota.\nRe-run with --yes to proceed.`,
  );
  process.exit(1);
}
const logger = createLogger(config);
const db = createDb({ connectionString: config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL, max: 4, logger });
const services = buildServices({ config, logger, db });

try {
  const info = await inspectDatabase(db);
  await db.tx(async (c) => {
    if (info.columnDim !== config.GEMINI_EMBEDDING_DIM) {
      console.log(`Changing vector column from ${info.columnDim} to ${config.GEMINI_EMBEDDING_DIM} dimensions (existing vectors are discarded).`);
      await c.query('DROP INDEX IF EXISTS document_chunks_embedding_hnsw_idx');
      await c.query('DELETE FROM document_chunks');
      await c.query(`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(${Number(config.GEMINI_EMBEDDING_DIM)})`);
      await c.query('CREATE INDEX document_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops)');
    }
    await c.query("UPDATE documents SET status = 'processing', error_message = NULL, updated_at = now()");
  });
  const { rows } = await db.query('SELECT id FROM documents ORDER BY created_at');
  console.log(`Re-embedding ${rows.length} document(s)...`);
  for (const r of rows) await services.documents.processDocument(r.id);
  const summary = await db.query('SELECT status, count(*)::int AS n FROM documents GROUP BY status');
  console.log('Done:', summary.rows.map((s) => `${s.n} ${s.status}`).join(', ') || 'no documents');
} catch (err) {
  console.error('Re-embedding failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
