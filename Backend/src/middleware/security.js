import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/errors.js';

export function corsMiddleware(config) {
  const allowed = new Set(config.frontendOrigins);
  return cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)), // disallowed origin => no CORS headers (browser blocks)
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-OmniPrep-Session'],
    exposedHeaders: ['X-OmniPrep-Session', 'X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
}

/** CSRF defence for cookie sessions: state-changing requests carrying an Origin must come from the frontend. */
export function originGuard(config) {
  const allowed = new Set(config.frontendOrigins);
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Requests from this origin are not allowed.'));
    next();
  };
}

export const limiter = (limit, message = 'Too many requests. Please slow down and try again shortly.') =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });
