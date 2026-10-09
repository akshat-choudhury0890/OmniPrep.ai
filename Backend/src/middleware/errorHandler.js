import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export const notFoundHandler = (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please try again.';
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
      if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    } else if (err instanceof ZodError) {
      status = 400; code = 'INVALID_REQUEST'; message = 'The request is invalid.';
      details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    } else if (err?.type === 'entity.parse.failed') {
      status = 400; code = 'INVALID_JSON'; message = 'The request body is not valid JSON.';
    } else if (err?.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'The request body is too large.';
    }

    const log = status >= 500 ? logger.error.bind(logger) : logger.info.bind(logger);
    log({ requestId: req.id, status, code, err: status >= 500 ? err : undefined, cause: err?.cause?.message }, 'request failed');

    if (res.headersSent) return;
    res.status(status).json({ success: false, error: { code, message, request_id: req.id, ...(details ? { details } : {}) } });
  };
}
