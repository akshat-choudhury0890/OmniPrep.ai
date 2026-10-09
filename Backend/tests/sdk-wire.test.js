// Drives the REAL @google/genai SDK against a local HTTP mock (via GEMINI_BASE_URL) to verify request shapes and
// response parsing of our embedding / generation / grounding calls. It does NOT prove behaviour of the live Gemini API.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGeminiClient } from '../src/services/geminiClient.js';
import { createEmbeddingService } from '../src/services/embeddingService.js';
import { createGeminiService } from '../src/services/geminiService.js';
import { createResourceSearchService } from '../src/services/resourceSearchService.js';
import { testConfig, testLogger, DIM } from './helpers.js';

let srv, base;
const seen = [];
before(async () => {
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, url: req.url, json, key: req.headers['x-goog-api-key'] });
      res.setHeader('content-type', 'application/json');
      if (req.url.includes(':batchEmbedContents')) {
        res.end(JSON.stringify({ embeddings: json.requests.map(() => ({ values: Array.from({ length: DIM }, (_, i) => (i === 0 ? 3 : 4)) })) }));
      } else if (req.url.includes(':embedContent')) {
        res.end(JSON.stringify({ embedding: { values: Array.from({ length: DIM }, () => 1) } }));
      } else if (req.url.includes(':generateContent') && json.tools) {
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://ocw.mit.edu/x', title: 'ocw.mit.edu' } }] } }] }));
      } else if (req.url.includes(':generateContent')) {
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ evidence_status: 'supported', answer: 'A.', used_sources: ['S1'] }) }] }, finishReason: 'STOP' }] }));
      } else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); srv.closeAllConnections?.(); });

const mk = () => {
  const config = testConfig({ GEMINI_BASE_URL: base, GEMINI_PRIMARY_MODEL: 'gemini-test-flash', GEMINI_EMBEDDING_MODEL: 'gemini-embedding-test' });
  const client = createGeminiClient(config);
  return { config, client, logger: testLogger(config) };
};

test('embeddings: SDK request carries taskType + outputDimensionality; response parsed and normalised', async () => {
  const { config, client, logger } = mk();
  const emb = createEmbeddingService({ config, logger, client });
  const out = await emb.embedDocuments(['first passage', 'second passage']);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(Math.hypot(...out[0]) - 1) < 1e-9);
  const req = seen.find((s) => s.url.includes('embed'));
  assert.ok(req.url.includes('gemini-embedding-test'));
  assert.equal(req.key, 'test-key');
  const first = req.json.requests?.[0] ?? req.json;
  assert.equal(first.taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(first.outputDimensionality, DIM);
});

test('generation: SDK sends system instruction, JSON mime type and response schema; JSON answer parsed', async () => {
  const { config, client, logger } = mk();
  const svc = createGeminiService({ config, logger, client });
  const r = await svc.generateAnswer({ systemInstruction: 'RULES', contents: [{ role: 'user', parts: [{ text: 'q' }] }] });
  assert.deepEqual([r.evidence_status, r.answer, r.used_sources, r.modelUsed], ['supported', 'A.', ['S1'], 'gemini-test-flash']);
  const req = seen.findLast((s) => s.url.includes(':generateContent'));
  assert.ok(req.url.includes('gemini-test-flash'));
  assert.equal(req.json.systemInstruction.parts[0].text, 'RULES');
  assert.equal(req.json.generationConfig.responseMimeType, 'application/json');
  assert.equal(req.json.generationConfig.responseSchema.type, 'OBJECT');
  assert.deepEqual(req.json.generationConfig.responseSchema.properties.evidence_status.enum, ['supported', 'partial', 'insufficient']);
});

test('grounding: SDK sends googleSearch tool and returns groundingMetadata we can read', async () => {
  const { config, client, logger } = mk();
  const svc = createResourceSearchService({ config, logger, client });
  const r = await svc.findResources('newton');
  assert.equal(r.resources[0].domain, 'ocw.mit.edu');
  const req = seen.findLast((s) => s.json?.tools);
  assert.ok(req.json.tools[0].googleSearch !== undefined);
});
