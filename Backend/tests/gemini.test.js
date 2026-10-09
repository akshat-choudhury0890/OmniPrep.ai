import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiService } from '../src/services/geminiService.js';
import { createEmbeddingService } from '../src/services/embeddingService.js';
import { classifyGeminiError } from '../src/services/geminiClient.js';
import { createFakeGemini, testConfig, testLogger, apiError, DIM } from './helpers.js';

function setup() {
  const config = testConfig();
  const fake = createFakeGemini(config);
  const logger = testLogger(config);
  const gemini = createGeminiService({ config, logger, client: fake.client });
  const embeddings = createEmbeddingService({ config, logger, client: fake.client });
  const req = {
    systemInstruction: 'SYS',
    contents: [{ role: 'user', parts: [{ text: '<source id="S1" document="a.txt">\nforces mass acceleration newton\n</source>\nStudent question: newton forces mass acceleration' }] }],
  };
  return { config, fake, gemini, embeddings, req };
}

test('primary ok -> no fallback call', async () => {
  const { gemini, fake, req } = setup();
  const r = await gemini.generateAnswer(req);
  assert.equal(r.modelUsed, 'primary-model');
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.evidence_status, 'supported');
  assert.equal(fake.calls.answer.length, 1);
});

test('primary timeout -> aborts primary request, falls back with identical prompt + schema', async () => {
  const { gemini, fake, req } = setup();
  fake.behaviour.primary = 'timeout';
  const t0 = Date.now();
  const r = await gemini.generateAnswer(req);
  assert.equal(r.modelUsed, 'fallback-model');
  assert.equal(r.fallbackUsed, true);
  assert.ok(Date.now() - t0 < 1000, 'must not wait indefinitely');
  assert.deepEqual(fake.calls.aborted, ['primary-model'], 'abandoned primary request must be cancelled');
  const [p, f] = fake.calls.answer;
  assert.deepEqual(p.contents, f.contents);
  assert.equal(p.systemInstruction, f.systemInstruction);
  assert.deepEqual(p.config.responseSchema, f.config.responseSchema);
});

for (const mode of ['429', '503', 'badjson', 'empty']) {
  test(`primary ${mode} -> fallback answers`, async () => {
    const { gemini, fake, req } = setup();
    fake.behaviour.primary = mode;
    const r = await gemini.generateAnswer(req);
    assert.equal(r.fallbackUsed, true);
    assert.equal(fake.calls.answer.length, 2);
  });
}

test('primary 400 (invalid request) is NOT retried on the fallback', async () => {
  const { gemini, fake, req } = setup();
  fake.behaviour.primary = '400';
  await assert.rejects(gemini.generateAnswer(req), (e) => e.status === 502 && e.code === 'AI_PROVIDER_ERROR');
  assert.equal(fake.calls.answer.length, 1);
});

test('safety block is NOT retried and maps to 422', async () => {
  const { gemini, fake, req } = setup();
  fake.behaviour.primary = 'blocked';
  await assert.rejects(gemini.generateAnswer(req), (e) => e.status === 422 && e.code === 'CONTENT_BLOCKED');
  assert.equal(fake.calls.answer.length, 1);
});

test('both models fail -> 503 MODEL_UNAVAILABLE with Retry-After, no secrets in message', async () => {
  const { gemini, fake, req } = setup();
  fake.behaviour.primary = 'timeout';
  fake.behaviour.fallback = '429';
  await assert.rejects(gemini.generateAnswer(req), (e) => {
    assert.equal(e.status, 503);
    assert.equal(e.code, 'MODEL_UNAVAILABLE');
    assert.equal(e.headers['Retry-After'], '10');
    assert.ok(!/test-key|primary-model/.test(e.message));
    return true;
  });
  assert.equal(fake.calls.answer.length, 2);
});

test('client disconnect aborts in-flight request and does not start the fallback', async () => {
  const { gemini, fake, req } = setup();
  fake.behaviour.primary = 'timeout';
  const ctrl = new AbortController();
  const p = gemini.generateAnswer({ ...req, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e) => e.status === 499);
  assert.equal(fake.calls.answer.length, 1);
  assert.deepEqual(fake.calls.aborted, ['primary-model']);
});

test('condenseQuestion never throws and falls back to the raw message', async () => {
  const { gemini, fake } = setup();
  assert.match(await gemini.condenseQuestion([{ role: 'user', content: 'x' }], 'and its units?'), /^standalone:/);
  fake.client.models.generateContent = async () => { throw apiError(500); };
  assert.equal(await gemini.condenseQuestion([{ role: 'user', content: 'x' }], 'and its units?'), 'and its units?');
});

test('error classification', () => {
  assert.equal(classifyGeminiError(apiError(429)).retryable, true);
  assert.equal(classifyGeminiError(apiError(503)).retryable, true);
  assert.equal(classifyGeminiError(apiError(404)).kind, 'model_not_found');
  assert.equal(classifyGeminiError(apiError(400)).retryable, false);
  assert.equal(classifyGeminiError(apiError(403)).retryable, false);
  assert.equal(classifyGeminiError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })).kind, 'network');
  assert.equal(classifyGeminiError(new Error('???')).retryable, false);
});

test('embeddings: unit-normalised, right task types and dimensionality, batching', async () => {
  const { embeddings, fake } = setup();
  const docs = await embeddings.embedDocuments(Array.from({ length: 120 }, (_, i) => `passage ${i} about mechanics`));
  assert.equal(docs.length, 120);
  assert.equal(docs[0].length, DIM);
  assert.ok(Math.abs(Math.hypot(...docs[5]) - 1) < 1e-9);
  assert.deepEqual(fake.calls.embed.map((c) => c.n), [50, 50, 20]);
  assert.ok(fake.calls.embed.every((c) => c.taskType === 'RETRIEVAL_DOCUMENT' && c.dim === DIM));
  await embeddings.embedQuery('what is force');
  assert.equal(fake.calls.embed.at(-1).taskType, 'RETRIEVAL_QUERY');
});

test('embeddings: transient errors are retried; persistent ones surface as 503; wrong dimension is rejected', async () => {
  const { embeddings, fake } = setup();
  fake.behaviour.embedFailures = 2;
  assert.equal((await embeddings.embedQuery('retry me')).length, DIM);
  fake.behaviour.embedFailures = 10;
  await assert.rejects(embeddings.embedQuery('x'), (e) => e.status === 503 && e.code === 'EMBEDDING_UNAVAILABLE');
  fake.behaviour.embedFailures = 0;
  fake.client.models.embedContent = async ({ contents }) => ({ embeddings: contents.map(() => ({ values: [1, 2, 3] })) });
  await assert.rejects(embeddings.embedQuery('x'), (e) => e.status === 502 && e.code === 'EMBEDDING_FAILED');
});
