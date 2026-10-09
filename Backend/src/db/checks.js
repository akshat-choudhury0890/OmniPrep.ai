/**
 * Startup/health checks: pgvector present, schema present, and the vector column dimension /
 * stored embedding model match the current configuration (never mix incompatible vectors).
 */
export async function inspectDatabase(db) {
  const ext = await db.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  const pgvectorVersion = ext.rows[0]?.extversion ?? null;
  const tbl = await db.query("SELECT to_regclass('public.document_chunks') AS t");
  const schemaPresent = Boolean(tbl.rows[0].t);
  let columnDim = null;
  if (schemaPresent) {
    const col = await db.query(
      `SELECT a.atttypmod AS dim FROM pg_attribute a
       WHERE a.attrelid = 'public.document_chunks'::regclass AND a.attname = 'embedding' AND NOT a.attisdropped`,
    );
    columnDim = col.rows[0]?.dim > 0 ? col.rows[0].dim : null;
  }
  return { pgvectorVersion, schemaPresent, columnDim };
}

/** pgvector >= 0.8.0 supports hnsw.iterative_scan (keeps filtered ANN queries from returning too few rows). */
export const supportsIterativeScan = (version) => {
  if (!version) return false;
  const [maj, min] = version.split('.').map(Number);
  return maj > 0 || min >= 8;
};

export async function assertDatabaseReady(db, config) {
  const info = await inspectDatabase(db);
  if (!info.pgvectorVersion) throw new Error('pgvector extension is not installed. Run `npm run migrate` (CREATE EXTENSION vector).');
  if (!info.schemaPresent) throw new Error('Database schema is missing. Run `npm run migrate`.');
  if (info.columnDim !== config.GEMINI_EMBEDDING_DIM) {
    throw new Error(
      `Embedding dimension mismatch: database column is vector(${info.columnDim}) but GEMINI_EMBEDDING_DIM=${config.GEMINI_EMBEDDING_DIM}. ` +
        'Revert the setting or run `npm run reembed -- --yes` to rebuild vectors.',
    );
  }
  const mixed = await db.query(
    "SELECT DISTINCT embedding_model FROM documents WHERE status = 'ready' AND embedding_model IS DISTINCT FROM $1",
    [config.GEMINI_EMBEDDING_MODEL],
  );
  if (mixed.rowCount) {
    throw new Error(
      `Stored vectors were created with a different embedding model (${mixed.rows.map((r) => r.embedding_model).join(', ')}) than GEMINI_EMBEDDING_MODEL=${config.GEMINI_EMBEDDING_MODEL}. ` +
        'Run `npm run reembed -- --yes` before starting.',
    );
  }
  return { ...info, iterativeScan: supportsIterativeScan(info.pgvectorVersion) };
}
