import 'dotenv/config';
import { z } from 'zod';

const int = (def, min = 0) => z.coerce.number().int().min(min).default(def);
const pgUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// URL');
const optionalStr = z.string().optional();

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(5000, 1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: int(0),
    FRONTEND_URL: z.string().min(1, 'is required'),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),

    DATABASE_URL: pgUrl,
    DATABASE_URL_UNPOOLED: pgUrl.optional(),
    DB_POOL_MAX: int(10, 1),

    GEMINI_API_KEY: z.string().min(1, 'is required'),
    GEMINI_PRIMARY_MODEL: z.string().min(1, 'is required'),
    GEMINI_FALLBACK_MODEL: z.string().min(1, 'is required'),
    GEMINI_EMBEDDING_MODEL: z.string().min(1, 'is required'),
    GEMINI_EMBEDDING_DIM: int(768, 8).refine((n) => n <= 2000, 'must be <= 2000 (pgvector HNSW limit)'),
    GEMINI_TIMEOUT_MS: int(20000, 1),
    GEMINI_FALLBACK_TIMEOUT_MS: int(20000, 1),
    GEMINI_EMBED_TIMEOUT_MS: int(30000, 1),
    GEMINI_RETRY_BASE_MS: int(1000, 0),
    GEMINI_SEARCH_MODEL: optionalStr,
    GEMINI_BASE_URL: optionalStr,

    RAG_TOP_K: int(5, 1),
    RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.5),
    RAG_MAX_CONTEXT_CHARS: int(12000, 500),
    CHUNK_SIZE: int(1000, 100),
    CHUNK_OVERLAP: int(200, 0),

    MAX_FILE_SIZE_BYTES: int(25 * 1024 * 1024, 1),
    MAX_FILES_PER_UPLOAD: int(10, 1),
    STORAGE_LIMIT_BYTES: int(100 * 1024 * 1024, 1),
    MAX_PDF_PAGES: int(500, 1),
    MAX_CHUNKS_PER_DOCUMENT: int(3000, 1),
    PROCESSING_CONCURRENCY: int(2, 1),

    STORAGE_DRIVER: z.enum(['r2', 'local']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./.data/uploads'),
    R2_ACCOUNT_ID: optionalStr,
    R2_ACCESS_KEY_ID: optionalStr,
    R2_SECRET_ACCESS_KEY: optionalStr,
    R2_BUCKET_NAME: optionalStr,
    R2_ENDPOINT: optionalStr,

    SEARCH_PROVIDER: z.enum(['gemini', 'brave', 'none']).default('gemini'),
    BRAVE_API_KEY: optionalStr,
    RESOURCE_SEARCH_TIMEOUT_MS: int(8000, 1),
    MAX_RESOURCES: int(5, 1),

    RATE_LIMIT_GENERAL_PER_MIN: int(120, 1),
    RATE_LIMIT_CHAT_PER_MIN: int(20, 1),
    RATE_LIMIT_UPLOAD_PER_MIN: int(10, 1),
  })
  .superRefine((v, ctx) => {
    const add = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.CHUNK_OVERLAP >= v.CHUNK_SIZE) add('CHUNK_OVERLAP', 'must be smaller than CHUNK_SIZE');
    if (v.STORAGE_DRIVER === 'r2') {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
        if (!v[k]) add(k, 'is required when STORAGE_DRIVER=r2');
      }
    }
    if (v.NODE_ENV === 'production' && v.STORAGE_DRIVER !== 'r2') {
      add('STORAGE_DRIVER', 'must be "r2" in production (local disk is not persistent storage)');
    }
    if (v.SEARCH_PROVIDER === 'brave' && !v.BRAVE_API_KEY) add('BRAVE_API_KEY', 'is required when SEARCH_PROVIDER=brave');
  });

export class ConfigError extends Error {}

/** Parse + validate env. Throws ConfigError listing variable NAMES only (never values). */
export function loadConfig(source = process.env) {
  const cleaned = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') cleaned[k] = v;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(config)'}: ${i.message}`);
    throw new ConfigError(`Invalid or missing environment configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  const sameSite = c.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax');
  const secure = c.COOKIE_SECURE ? c.COOKIE_SECURE === 'true' : isProd;
  if (sameSite === 'none' && !secure) {
    throw new ConfigError('Invalid environment configuration:\n  - COOKIE_SECURE: must be true when COOKIE_SAMESITE=none');
  }
  return {
    ...c,
    isProd,
    frontendOrigins: c.FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    cookie: { sameSite, secure },
    SEARCH_MODEL: c.GEMINI_SEARCH_MODEL ?? c.GEMINI_FALLBACK_MODEL,
  };
}
