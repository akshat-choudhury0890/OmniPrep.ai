import { AppError } from '../utils/errors.js';
import { sleep } from '../utils/text.js';
import { GeminiError, runWithTimeout } from './geminiClient.js';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 4;

function normalise(values) {
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return values.map((v) => v / norm);
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof GeminiError) {
    if (err.kind === 'client_aborted') return new AppError(499, 'CLIENT_CLOSED_REQUEST', 'Request cancelled');
    if (err.retryable) return new AppError(503, 'EMBEDDING_UNAVAILABLE', 'The embedding service is temporarily unavailable. Please try again shortly.', { cause: err, headers: { 'Retry-After': '10' } });
  }
  return new AppError(502, 'EMBEDDING_FAILED', 'The embedding service returned an error.', { cause: err });
}

/** Embeddings are independent of answer-generation fallback: this service has its own timeout + retry. */
export function createEmbeddingService({ config, logger, client }) {
  const model = config.GEMINI_EMBEDDING_MODEL;
  const dim = config.GEMINI_EMBEDDING_DIM;
  const log = logger.child({ svc: 'embeddings' });

  async function embedBatch(texts, taskType, parentSignal) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await runWithTimeout(
          (signal) => client.models.embedContent({ model, contents: texts, config: { taskType, outputDimensionality: dim, abortSignal: signal } }),
          { timeoutMs: config.GEMINI_EMBED_TIMEOUT_MS, parentSignal, model },
        );
        const embeddings = res?.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
          throw new GeminiError('malformed_output', 'Embedding response count mismatch', { model });
        }
        return embeddings.map((e) => {
          if (!Array.isArray(e?.values) || e.values.length !== dim) {
            throw new GeminiError('malformed_output', `Embedding has ${e?.values?.length} dims, expected ${dim}`, { model });
          }
          return normalise(e.values); // required for MRL-truncated Gemini embeddings; harmless otherwise
        });
      } catch (err) {
        const e = err instanceof GeminiError ? err : err;
        if (attempt >= MAX_ATTEMPTS || !e.retryable) throw toAppError(e);
        const delay = config.GEMINI_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
        log.warn({ attempt, kind: e.kind, delay }, 'embedding attempt failed, retrying');
        await sleep(delay);
      }
    }
  }

  async function embed(texts, taskType, signal) {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), taskType, signal)));
    }
    return out;
  }

  return {
    model,
    dim,
    embedDocuments: (texts, signal) => embed(texts, 'RETRIEVAL_DOCUMENT', signal),
    embedQuery: async (text, signal) => (await embed([text], 'RETRIEVAL_QUERY', signal))[0],
  };
}
