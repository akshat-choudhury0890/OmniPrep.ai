import { loadConfig, ConfigError } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { createDb } from './db/pool.js';
import { assertDatabaseReady } from './db/checks.js';
import { buildServices } from './services/index.js';
import { verifyModels } from './services/geminiClient.js';
import { createApp } from './app.js';
import cors from 'cors';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message); // names only, never values
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config);
const db = createDb({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX, logger });

try {
  const dbInfo = await assertDatabaseReady(db, config);
  logger.info({ pgvector: dbInfo.pgvectorVersion, iterativeScan: dbInfo.iterativeScan }, 'database ready');

  const services = buildServices({ config, logger, db, iterativeScan: dbInfo.iterativeScan });
  await services.storage.ping().catch((err) => {
    throw new Error(`Storage check failed (${config.STORAGE_DRIVER}): ${err.name}`);
  });
  const app = createApp({ config, logger, db, services });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.NODE_ENV, storage: config.STORAGE_DRIVER }, 'OmniPrep.ai API listening'));

  const recovered = await services.documents.recoverInterrupted();
  if (recovered) logger.info({ recovered }, 'resumed interrupted document processing');

  // Non-blocking sanity check of configured model IDs against what this API key can actually use.
  verifyModels(services.client, config)
    .then((rows) => rows.filter((r) => !r.found || !r.supportsAction).forEach((r) => logger.warn({ role: r.role, model: r.model, found: r.found }, 'configured Gemini model not available for this key - run `npm run models:check`')))
    .catch((err) => logger.warn({ message: err.message }, 'could not verify Gemini model IDs at startup'));

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await Promise.race([services.queue.idle(), new Promise((r) => setTimeout(r, 10_000))]);
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 20_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} catch (err) {
  logger.fatal({ message: err.message }, 'startup failed');
  console.error(`\nStartup failed: ${err.message}`);
  process.exit(1);
}
