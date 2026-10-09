import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { sanitizeFilename } from '../utils/text.js';

/** Streams uploads to a temp dir (not memory). The route deletes the temp files in a finally block. */
export function createUploadMiddleware(config) {
  const dir = path.join(os.tmpdir(), 'omniprep-uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const handler = multer({
    storage: multer.diskStorage({ destination: dir, filename: (req, file, cb) => cb(null, randomUUID()) }),
    limits: { fileSize: config.MAX_FILE_SIZE_BYTES, files: config.MAX_FILES_PER_UPLOAD, fields: 5, parts: config.MAX_FILES_PER_UPLOAD + 5 },
    fileFilter: (req, file, cb) => {
      const name = sanitizeFilename(file.originalname);
      if (!/\.(pdf|txt)$/i.test(name)) {
        (req.skippedFiles ??= []).push({ filename: name, code: 'UNSUPPORTED_FILE_TYPE', message: 'Only .pdf and .txt files are supported.', status: 415 });
        return cb(null, false); // skip this file without aborting the rest of the batch
      }
      cb(null, true);
    },
  }).array('files', config.MAX_FILES_PER_UPLOAD);

  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const map = {
          LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', `A file exceeds the ${Math.round(config.MAX_FILE_SIZE_BYTES / 1048576)} MB size limit.`],
          LIMIT_FILE_COUNT: [400, 'TOO_MANY_FILES', `At most ${config.MAX_FILES_PER_UPLOAD} files per upload.`],
          LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FIELD', 'Send files in the "files" form field.'],
          LIMIT_PART_COUNT: [400, 'TOO_MANY_PARTS', 'Malformed multipart request.'],
        };
        const [status, code, message] = map[err.code] ?? [400, 'UPLOAD_ERROR', 'The upload could not be processed.'];
        return next(new AppError(status, code, message));
      }
      if (/multipart|boundary|Unexpected end of form|Malformed/i.test(err.message ?? '')) {
        return next(new AppError(400, 'MALFORMED_MULTIPART', 'The upload request was malformed. Send multipart/form-data.'));
      }
      next(err);
    });
}
