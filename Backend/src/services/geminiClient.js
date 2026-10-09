import { GoogleGenAI } from '@google/genai';

export function createGeminiClient(config) {
  return new GoogleGenAI({
    apiKey: config.GEMINI_API_KEY,
    ...(config.GEMINI_BASE_URL ? { httpOptions: { baseUrl: config.GEMINI_BASE_URL } } : {}),
  });
}

/**
 * kind: timeout | rate_limited | transient | network | model_not_found  (retryable: another attempt/model may work)
 *       invalid_request | auth | blocked | client_aborted | unknown        (not retryable: same request will fail again)
 *       malformed_output | empty_output                                   (retryable on another model)
 */
export class GeminiError extends Error {
  constructor(kind, message, { retryable = false, status, cause, model } = {}) {
    super(message, { cause });
    this.name = 'GeminiError';
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
    this.model = model;
  }
}

const NET_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

export function classifyGeminiError(err, model) {
  if (err instanceof GeminiError) return err;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const code = err?.cause?.code ?? err?.code;
  const mk = (kind, retryable) =>
    new GeminiError(kind, `Gemini ${kind}${status ? ` (HTTP ${status})` : ''}`, { retryable, status, cause: err, model });
  if (status === 429) return mk('rate_limited', true);
  if ([408, 500, 502, 503, 504].includes(status)) return mk('transient', true);
  if (status === 404) return mk('model_not_found', true);
  if (status === 400) return mk('invalid_request', false); // also what Gemini returns for a bad API key
  if (status === 401 || status === 403) return mk('auth', false);
  if (NET_CODES.has(code) || /fetch failed|network|socket hang up/i.test(err?.message ?? '')) return mk('network', true);
  return mk('unknown', false);
}

/** Reject as soon as `signal` aborts, even if the underlying SDK call ignores the signal. */
export function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * Runs fn(signal) with a hard timeout. On timeout the signal is aborted (cancelling the HTTP request
 * where the SDK supports it) and the promise rejects immediately. `parentSignal` = client disconnect.
 */
export async function runWithTimeout(fn, { timeoutMs, parentSignal, model }) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(new Error('timeout')); }, timeoutMs);
  const onParent = () => ctrl.abort(new Error('client_aborted'));
  if (parentSignal) {
    if (parentSignal.aborted) onParent();
    else parentSignal.addEventListener('abort', onParent, { once: true });
  }
  try {
    return await raceAbort(Promise.resolve().then(() => fn(ctrl.signal)), ctrl.signal);
  } catch (err) {
    if (timedOut) throw new GeminiError('timeout', `Gemini request timed out after ${timeoutMs}ms`, { retryable: true, cause: err, model });
    if (parentSignal?.aborted) throw new GeminiError('client_aborted', 'Client disconnected', { cause: err, model });
    throw classifyGeminiError(err, model);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParent);
  }
}

/** List models visible to the key and check the configured IDs exist and support the needed action. */
export async function verifyModels(client, config) {
  const wanted = [
    { role: 'primary', model: config.GEMINI_PRIMARY_MODEL, action: 'generateContent' },
    { role: 'fallback', model: config.GEMINI_FALLBACK_MODEL, action: 'generateContent' },
    { role: 'embedding', model: config.GEMINI_EMBEDDING_MODEL, action: 'embedContent' },
  ];
  const available = new Map();
  const pager = await client.models.list({ config: { pageSize: 100 } });
  for await (const m of pager) available.set(String(m.name).replace(/^models\//, ''), m.supportedActions ?? []);
  return wanted.map((w) => {
    const actions = available.get(w.model);
    // Embedding models are listed with embedContent and/or batchEmbedContents depending on API version.
    const supports = actions ? actions.some((a) => a === w.action || (w.action === 'embedContent' && /embed/i.test(a))) : false;
    return { ...w, found: Boolean(actions), supportsAction: supports };
  });
}
