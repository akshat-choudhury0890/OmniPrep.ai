import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config/env.js';
import { testEnv } from './helpers.js';

test('missing config is reported by NAME only; secrets never echoed', () => {
  const env = testEnv({ GEMINI_API_KEY: '', SESSION_SECRET: 'short-secret-value' });
  delete env.GEMINI_API_KEY;
  try { loadConfig(env); assert.fail('should throw'); } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.match(e.message, /GEMINI_API_KEY/);
    assert.match(e.message, /SESSION_SECRET/);
    assert.ok(!e.message.includes('short-secret-value'));
  }
});

test('production requires R2 storage and R2 credentials', () => {
  assert.throws(() => loadConfig(testEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })), /STORAGE_DRIVER/);
  assert.throws(() => loadConfig(testEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'r2' })), /R2_ACCOUNT_ID/);
  const ok = loadConfig(testEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET_NAME: 'd' }));
  assert.deepEqual(ok.cookie, { sameSite: 'none', secure: true });
});

test('embedding dim, overlap and brave key are validated; origins normalised', () => {
  assert.throws(() => loadConfig(testEnv({ GEMINI_EMBEDDING_DIM: '3072' })), /GEMINI_EMBEDDING_DIM/);
  assert.throws(() => loadConfig(testEnv({ CHUNK_OVERLAP: '400', CHUNK_SIZE: '400' })), /CHUNK_OVERLAP/);
  assert.throws(() => loadConfig(testEnv({ SEARCH_PROVIDER: 'brave' })), /BRAVE_API_KEY/);
  assert.throws(() => loadConfig(testEnv({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })), /COOKIE_SECURE/);
  assert.deepEqual(loadConfig(testEnv({ FRONTEND_URL: 'https://a.example.com/, http://localhost:5173' })).frontendOrigins, ['https://a.example.com', 'http://localhost:5173']);
});
