import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ApiError } from '@google/genai';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/omniprep_test';
export const DIM = 256;

export function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    SESSION_SECRET: 'x'.repeat(40),
    DATABASE_URL: TEST_DB,
    GEMINI_API_KEY: 'test-key',
    GEMINI_PRIMARY_MODEL: 'primary-model',
    GEMINI_FALLBACK_MODEL: 'fallback-model',
    GEMINI_EMBEDDING_MODEL: 'embed-model',
    GEMINI_EMBEDDING_DIM: String(DIM),
    GEMINI_TIMEOUT_MS: '150',
    GEMINI_FALLBACK_TIMEOUT_MS: '150',
    GEMINI_EMBED_TIMEOUT_MS: '1000',
    GEMINI_RETRY_BASE_MS: '1',
    RAG_MIN_SIMILARITY: '0.3',
    CHUNK_SIZE: '400',
    CHUNK_OVERLAP: '80',
    MAX_FILE_SIZE_BYTES: '200000',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: path.join(os.tmpdir(), `omniprep-test-${process.pid}`),
    LOG_LEVEL: 'silent',
    RESOURCE_SEARCH_TIMEOUT_MS: '1000',
    RATE_LIMIT_GENERAL_PER_MIN: '10000',
    RATE_LIMIT_CHAT_PER_MIN: '10000',
    RATE_LIMIT_UPLOAD_PER_MIN: '10000',
    ...overrides,
  };
}
export const testConfig = (o) => loadConfig(testEnv(o));
export const testLogger = (config) => createLogger(config);

export const apiError = (status, message = `HTTP ${status}`) => new ApiError({ message, status });

const STOP = new Set(['the', 'and', 'for', 'are', 'what', 'how', 'does', 'that', 'this', 'with', 'from', 'about', 'your', 'you', 'its', 'was', 'were', 'which', 'when', 'who']);
const words = (t) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const hash = (w) => { let h = 2166136261; for (const c of w) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h) % DIM; };
/** Deterministic bag-of-words "embedding": shared vocabulary => high cosine similarity. */
export function bowVector(text) {
  const v = new Array(DIM).fill(0);
  for (const w of words(text)) v[hash(w)] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/**
 * Fake @google/genai client. `behaviour` can be mutated per test:
 *  primary/fallback: ok | timeout | 429 | 503 | 400 | badjson | blocked | empty
 *  embedFailures: number of upcoming embedContent calls that fail with 503
 *  search: ok | fail | empty
 */
export function createFakeGemini(config) {
  const calls = { answer: [], condense: [], search: [], embed: [], aborted: [] };
  const behaviour = { primary: 'ok', fallback: 'ok', embedFailures: 0, search: 'ok' };

  const models = {
    async embedContent({ contents, config: cfg }) {
      calls.embed.push({ n: contents.length, taskType: cfg.taskType, dim: cfg.outputDimensionality });
      if (behaviour.embedFailures > 0) { behaviour.embedFailures--; throw apiError(503); }
      return { embeddings: contents.map((t) => ({ values: bowVector(t) })) };
    },
    async generateContent({ model, contents, config: cfg }) {
      if (cfg.tools) {
        calls.search.push({ model });
        if (behaviour.search === 'fail') throw apiError(500);
        if (behaviour.search === 'empty') return { candidates: [{ groundingMetadata: { groundingChunks: [] } }] };
        return {
          candidates: [{
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'blog.example.com' } },
                { web: { uri: 'http://insecure.example.com/page', title: 'insecure.example.com' } },
                { web: { uri: 'https://ocw.mit.edu/courses/physics/', title: 'ocw.mit.edu' } },
                { web: { uri: 'https://ocw.mit.edu/courses/physics/#frag', title: 'dup' } },
              ],
              groundingSupports: [{ groundingChunkIndices: [2], segment: { text: 'MIT OpenCourseWare physics lectures.' } }],
            },
          }],
        };
      }
      const lastText = contents.at(-1).parts[0].text;
      if (!cfg.responseSchema) { calls.condense.push({ model, lastText }); return { text: `standalone: ${lastText}` }; }

      const role = model === config.GEMINI_PRIMARY_MODEL ? 'primary' : 'fallback';
      calls.answer.push({ model, role, contents, systemInstruction: cfg.systemInstruction, config: cfg });
      const mode = behaviour[role];
      if (mode === 'timeout') {
        return new Promise((_, reject) => cfg.abortSignal.addEventListener('abort', () => { calls.aborted.push(model); reject(new Error('aborted')); }));
      }
      if (['429', '503', '400'].includes(mode)) throw apiError(Number(mode));
      if (mode === 'badjson') return { text: '{not json', candidates: [{ finishReason: 'STOP' }] };
      if (mode === 'empty') return { text: '', candidates: [{ finishReason: 'STOP' }] };
      if (mode === 'blocked') return { text: '', promptFeedback: { blockReason: 'SAFETY' } };

      const question = lastText.split('Student question:').pop();
      const sources = [...lastText.matchAll(/<source id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ id: m[1], text: m[2] }));
      const qw = new Set(words(question));
      const hits = sources.filter((s) => words(s.text).filter((w) => qw.has(w)).length >= 2);
      const out = hits.length
        ? { evidence_status: 'supported', answer: `From your documents: ${hits[0].text.split('.')[0]}.`, used_sources: [hits[0].id, 'S99'] }
        : { evidence_status: 'insufficient', answer: 'The uploaded documents do not contain enough information.', used_sources: [] };
      return { text: JSON.stringify(out), candidates: [{ finishReason: 'STOP' }] };
    },
  };
  return { client: { models }, calls, behaviour };
}

/** Build a small, valid PDF. pages: array of strings (one per page); '' => blank (image-only style) page. */
export function makePdf(pages) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = [];
  const n = pages.length;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const lines = text.match(/.{1,85}(\s|$)/g) ?? [];
    const stream = text ? `BT /F1 11 Tf 14 TL 40 750 Td ${lines.map((l) => `(${esc(l.trim())}) Tj T*`).join(' ')} ET` : '';
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const cleanDir = (d) => fs.rmSync(d, { recursive: true, force: true });
