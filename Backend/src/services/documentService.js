import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../utils/errors.js';
import { sanitizeFilename } from '../utils/text.js';
import { toVectorLiteral } from '../db/pool.js';
import { detectFileType, parseDocument, ProcessingError } from './documentParser.js';
import { chunkPages } from './chunker.js';

const MIN_EXTRACTED_CHARS = 100;
const INSERT_BATCH = 100;
const CONTENT_TYPES = { pdf: 'application/pdf', txt: 'text/plain; charset=utf-8' };

export const toApiDocument = (r) => ({
  id: r.id,
  filename: r.filename,
  file_type: r.file_type,
  size_bytes: Number(r.file_size),
  status: r.status.toUpperCase(), // PROCESSING | READY | FAILED (matches the frontend contract)
  chunks_indexed: r.chunk_count,
  page_count: r.page_count,
  error_message: r.error_message,
  created_at: new Date(r.created_at).toISOString(),
});

async function readHead(filePath, bytes) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function userSafeFailure(err) {
  if (err instanceof ProcessingError) return err.message;
  if (err instanceof AppError && err.code.startsWith('EMBEDDING')) {
    return 'The embedding service was unavailable while indexing this document. Use retry to try again.';
  }
  return 'Processing failed unexpectedly. Use retry to try again.';
}

export function createDocumentService({ config, db, logger, storage, embeddings, queue }) {
  const log = logger.child({ svc: 'documents' });

  async function processDocument(id) {
    const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
    const doc = rows[0];
    if (!doc || doc.status !== 'processing') return; // deleted meanwhile, or already handled
    const started = Date.now();
    try {
      const buffer = await storage.get(doc.storage_key);
      const { pages, pageCount } = await parseDocument({ type: doc.file_type, buffer, maxPages: config.MAX_PDF_PAGES });
      const totalChars = pages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
      if (totalChars < MIN_EXTRACTED_CHARS) {
        throw new ProcessingError(
          doc.file_type === 'pdf'
            ? 'No extractable text found. This looks like a scanned or image-only PDF; OCR is not supported.'
            : 'This file contains no readable text.',
        );
      }
      const chunks = chunkPages(pages, { size: config.CHUNK_SIZE, overlap: config.CHUNK_OVERLAP });
      if (!chunks.length) throw new ProcessingError('No usable text passages could be extracted.');
      if (chunks.length > config.MAX_CHUNKS_PER_DOCUMENT) {
        throw new ProcessingError(`This document is too large to index (${chunks.length} passages; limit ${config.MAX_CHUNKS_PER_DOCUMENT}).`);
      }
      const vectors = await embeddings.embedDocuments(chunks.map((c) => c.content));

      // One transaction: chunks + status flip commit together, so no partial/orphan chunks on failure.
      await db.tx(async (c) => {
        const lock = await c.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE', [id]);
        if (!lock.rowCount) return; // deleted while processing
        await c.query('DELETE FROM document_chunks WHERE document_id = $1', [id]);
        for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
          const slice = chunks.slice(i, i + INSERT_BATCH);
          const params = [id];
          const values = slice.map((ch, j) => {
            params.push(ch.chunkIndex, ch.content, ch.pageNumber, toVectorLiteral(vectors[i + j]));
            const b = 2 + j * 4;
            return `($1, $${b}, $${b + 1}, $${b + 2}, $${b + 3}::vector)`;
          });
          await c.query(`INSERT INTO document_chunks (document_id, chunk_index, content, page_number, embedding) VALUES ${values.join(',')}`, params);
        }
        await c.query(
          `UPDATE documents SET status = 'ready', error_message = NULL, chunk_count = $2, page_count = $3,
             embedding_model = $4, embedding_dim = $5, updated_at = now() WHERE id = $1`,
          [id, chunks.length, pageCount, embeddings.model, embeddings.dim],
        );
      });
      log.info({ documentId: id, chunks: chunks.length, ms: Date.now() - started }, 'document processed');
    } catch (err) {
      log.warn({ documentId: id, err: { name: err.name, message: err.message, code: err.code } }, 'document processing failed');
      try {
        await db.query(
          "UPDATE documents SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1 AND status = 'processing'",
          [id, userSafeFailure(err)],
        );
      } catch (dbErr) {
        log.error({ documentId: id, err: dbErr }, 'could not record processing failure');
      }
    }
  }

  async function ingestUploads(ownerId, files) {
    const { rows } = await db.query('SELECT COALESCE(SUM(file_size), 0)::bigint AS used FROM documents WHERE owner_id = $1', [ownerId]);
    let used = Number(rows[0].used);
    const documents = [];
    const rejected = [];
    for (const f of files) {
      const filename = sanitizeFilename(f.originalname);
      try {
        const ext = path.extname(filename).slice(1).toLowerCase();
        if (!f.size) throw new AppError(400, 'EMPTY_FILE', 'The file is empty.');
        const head = await readHead(f.path, 65536);
        const type = detectFileType({ head, ext, mime: f.mimetype });
        if (used + f.size > config.STORAGE_LIMIT_BYTES) {
          throw new AppError(413, 'STORAGE_LIMIT_EXCEEDED', 'Not enough storage left for this file. Delete a document and try again.');
        }
        const id = randomUUID();
        const key = `documents/${ownerId}/${id}.${type}`; // server-generated; user filename never touches the key
        await storage.put(key, await fs.readFile(f.path), CONTENT_TYPES[type]);
        let row;
        try {
          ({ rows: [row] } = await db.query(
            `INSERT INTO documents (id, owner_id, filename, file_type, file_size, storage_key, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'processing') RETURNING *`,
            [id, ownerId, filename, type, f.size, key],
          ));
        } catch (err) {
          await storage.delete(key).catch(() => {});
          throw err;
        }
        used += f.size;
        documents.push(toApiDocument(row));
        queue.enqueue(() => processDocument(id));
      } catch (err) {
        if (err instanceof AppError) {
          rejected.push({ filename, code: err.code, message: err.message, status: err.status });
        } else {
          log.error({ err, filename }, 'upload failed');
          rejected.push({ filename, code: 'UPLOAD_FAILED', message: 'The file could not be stored. Please try again.', status: 502 });
        }
      }
    }
    return { documents, rejected };
  }

  async function list(ownerId) {
    const [docs, used] = await Promise.all([
      db.query('SELECT * FROM documents WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]),
      db.query('SELECT COALESCE(SUM(file_size), 0)::bigint AS used FROM documents WHERE owner_id = $1', [ownerId]),
    ]);
    return {
      documents: docs.rows.map(toApiDocument),
      storage_used_bytes: Number(used.rows[0].used),
      storage_limit_bytes: config.STORAGE_LIMIT_BYTES,
    };
  }

  async function get(ownerId, id) {
    const { rows } = await db.query('SELECT * FROM documents WHERE id = $1 AND owner_id = $2', [id, ownerId]);
    if (!rows[0]) throw notFound('Document');
    return toApiDocument(rows[0]);
  }

  /** Storage first, then DB: if storage deletion fails the record stays (consistent, retryable) instead of orphaning a private file. */
  async function remove(ownerId, id) {
    const { rows } = await db.query('SELECT id, storage_key FROM documents WHERE id = $1 AND owner_id = $2', [id, ownerId]);
    if (!rows[0]) throw notFound('Document');
    try {
      await storage.delete(rows[0].storage_key);
    } catch (err) {
      log.error({ err, documentId: id }, 'storage deletion failed; document kept');
      throw new AppError(502, 'STORAGE_UNAVAILABLE', 'The stored file could not be deleted right now. Nothing was removed; please try again.', { cause: err });
    }
    await db.query('DELETE FROM documents WHERE id = $1 AND owner_id = $2', [id, ownerId]); // chunks cascade
    return { success: true, deleted_id: id };
  }

  async function retry(ownerId, id) {
    const { rows } = await db.query(
      `UPDATE documents SET status = 'processing', error_message = NULL, updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND status = 'failed' RETURNING *`,
      [id, ownerId],
    );
    if (!rows[0]) {
      await get(ownerId, id); // 404 if it isn't theirs
      throw new AppError(409, 'NOT_RETRYABLE', 'Only failed documents can be retried.');
    }
    queue.enqueue(() => processDocument(id));
    return toApiDocument(rows[0]);
  }

  /** Single-instance recovery: anything still 'processing' at boot was interrupted by a restart. */
  async function recoverInterrupted() {
    const { rows } = await db.query("SELECT id FROM documents WHERE status = 'processing' ORDER BY created_at");
    rows.forEach((r) => queue.enqueue(() => processDocument(r.id)));
    return rows.length;
  }

  return { ingestUploads, list, get, remove, retry, processDocument, recoverInterrupted };
}
