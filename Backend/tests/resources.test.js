import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceSearchService, validateResourceUrl } from '../src/services/resourceSearchService.js';
import { createFakeGemini, testConfig, testLogger } from './helpers.js';

const redirectingFetch = async (url) => ({ ok: true, status: 302, headers: { get: (h) => (h === 'location' ? 'https://www.khanacademy.org/science/physics' : null) } });

function make(overrides, fetchImpl = redirectingFetch) {
  const config = testConfig(overrides);
  const fake = createFakeGemini(config);
  return { fake, svc: createResourceSearchService({ config, logger: testLogger(config), client: fake.client, fetchImpl }) };
}

test('Gemini grounding: https only, redirects resolved (one hop), deduped, trusted domains first', async () => {
  const { svc } = make();
  const r = await svc.findResources('newton second law');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.resources.map((x) => x.domain), ['khanacademy.org', 'ocw.mit.edu']); // http:// dropped, #frag dup removed, provider order kept among trusted
  assert.ok(r.resources.every((x) => x.url.startsWith('https://') && x.trusted_domain === true));
  assert.equal(r.resources[1].description, 'MIT OpenCourseWare physics lectures.');
});

test('unresolvable redirect links are dropped rather than invented', async () => {
  const { svc } = make({}, async () => { throw new Error('network'); });
  const r = await svc.findResources('q');
  assert.deepEqual(r.resources.map((x) => x.domain), ['ocw.mit.edu']);
});

test('search failure and empty results are reported without throwing', async () => {
  const a = make(); a.fake.behaviour.search = 'fail';
  assert.deepEqual(await a.svc.findResources('q'), { resources: [], status: 'error' });
  const b = make(); b.fake.behaviour.search = 'empty';
  assert.deepEqual(await b.svc.findResources('q'), { resources: [], status: 'empty' });
});

test('search timeout is enforced', async () => {
  const { svc, fake } = make({ RESOURCE_SEARCH_TIMEOUT_MS: '30' });
  fake.client.models.generateContent = () => new Promise(() => {});
  const t0 = Date.now();
  assert.equal((await svc.findResources('q')).status, 'error');
  assert.ok(Date.now() - t0 < 500);
});

test('SEARCH_PROVIDER=none disables lookup', async () => {
  const { svc, fake } = make({ SEARCH_PROVIDER: 'none' });
  assert.deepEqual(await svc.findResources('q'), { resources: [], status: 'disabled' });
  assert.equal(fake.calls.search.length, 0);
});

test('Brave provider: maps results, strips markup, sends key only in header, filters bad URLs', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url: String(url), headers: opts.headers };
    return { ok: true, json: async () => ({ web: { results: [
      { title: 'Intro <strong>Mechanics</strong>', url: 'https://hyperphysics.phy-astr.gsu.edu/hbase/mot.html', description: 'Motion <b>basics</b>' },
      { title: 'bad', url: 'javascript:alert(1)' },
      { title: 'local', url: 'https://localhost/x' },
      { title: 'ip', url: 'https://10.0.0.1/x' },
      { title: 'random', url: 'https://some-blog.com/post', description: 'x' },
    ] } }) };
  };
  const { svc } = make({ SEARCH_PROVIDER: 'brave', BRAVE_API_KEY: 'brave-secret' }, fetchImpl);
  const r = await svc.findResources('newton');
  assert.deepEqual(r.resources.map((x) => x.domain), ['hyperphysics.phy-astr.gsu.edu', 'some-blog.com']);
  assert.equal(r.resources[0].title, 'Intro Mechanics');
  assert.equal(r.resources[0].description, 'Motion basics');
  assert.equal(r.resources[1].trusted_domain, false);
  assert.ok(!seen.url.includes('brave-secret'));
  assert.equal(seen.headers['X-Subscription-Token'], 'brave-secret');
  assert.ok(r.resources.length <= 5);
});

test('validateResourceUrl', () => {
  assert.ok(validateResourceUrl('https://ocw.mit.edu/a'));
  for (const bad of ['http://ocw.mit.edu', 'ftp://x.edu', 'https://u:p@x.edu/', 'https://localhost', 'https://127.0.0.1', 'https://intranet', 'not a url', 'https://x.local/']) {
    assert.equal(validateResourceUrl(bad), null, bad);
  }
});
