import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const idParam = z.string().uuid();
const parseId = (v) => {
  const r = idParam.safeParse(v);
  if (!r.success) throw new AppError(400, 'INVALID_ID', 'Invalid document id.');
  return r.data;
};

export function documentsRouter({ documents, uploadMiddleware, uploadLimiter }) {
  const r = Router();

  r.post('/upload', uploadLimiter, uploadMiddleware, async (req, res) => {
    const files = req.files ?? [];
    try {
      const skipped = req.skippedFiles ?? [];
      if (!files.length && !skipped.length) {
        throw new AppError(400, 'NO_FILES', 'No files received. Send multipart/form-data with one or more "files" fields.');
      }
      const result = files.length ? await documents.ingestUploads(req.ownerId, files) : { documents: [], rejected: [] };
      const rejected = [...skipped, ...result.rejected];
      if (!result.documents.length) {
        const first = rejected[0];
        throw new AppError(first.status ?? 400, first.code, first.message, { details: { rejected } });
      }
      res.status(201).json({ success: true, documents: result.documents, rejected });
    } finally {
      await Promise.all(files.map((f) => fs.rm(f.path, { force: true }))); // always clean up temp files
    }
  });

  r.get('/', async (req, res) => res.json(await documents.list(req.ownerId)));
  r.get('/:id', async (req, res) => res.json({ document: await documents.get(req.ownerId, parseId(req.params.id)) }));
  r.post('/:id/retry', async (req, res) => res.status(202).json({ success: true, document: await documents.retry(req.ownerId, parseId(req.params.id)) }));
  r.delete('/:id', async (req, res) => res.json(await documents.remove(req.ownerId, parseId(req.params.id))));
  return r;
}
