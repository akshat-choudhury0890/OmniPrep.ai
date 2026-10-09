import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsMiddleware, originGuard, limiter } from './middleware/security.js';
import { createSessionMiddleware } from './middleware/session.js';
import { createUploadMiddleware } from './middleware/upload.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { documentsRouter } from './routes/documents.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';

export function createApp({ config, logger, db, services }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') },
      serializers: {
        req: (r) => ({ id: r.id, method: r.method, url: r.url?.split('?')[0] }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(corsMiddleware(config));
  app.use('/api/health', healthRouter({ db, storage: services.storage, config }));

  app.use('/api', originGuard(config));
  app.use('/api', limiter(config.RATE_LIMIT_GENERAL_PER_MIN));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createSessionMiddleware(config));

  app.use(
    '/api/documents',
    documentsRouter({
      documents: services.documents,
      uploadMiddleware: createUploadMiddleware(config),
      uploadLimiter: limiter(config.RATE_LIMIT_UPLOAD_PER_MIN, 'Too many uploads. Please wait a minute and try again.'),
    }),
  );
  app.use('/api/chat', chatRouter({ rag: services.rag, chatLimiter: limiter(config.RATE_LIMIT_CHAT_PER_MIN, 'You are asking questions too quickly. Please wait a moment.') }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
