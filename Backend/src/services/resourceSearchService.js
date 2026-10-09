import net from 'node:net';
import { runWithTimeout } from './geminiClient.js';
import { excerpt } from '../utils/text.js';

/**
 * Curated heuristic - NOT a verification. A domain is "trusted" if it is an education/government TLD
 * or on this short allowlist of long-established learning/reference sites.
 */
const TRUSTED_SUFFIXES = [
  'khanacademy.org', 'openstax.org', 'libretexts.org', 'wikipedia.org', 'britannica.com', 'arxiv.org', 'nature.com',
  'coursera.org', 'edx.org', 'brilliant.org', 'geeksforgeeks.org', 'developer.mozilla.org', 'docs.python.org', 'w3.org',
  'mathworld.wolfram.com', 'nptel.ac.in', 'ncert.nic.in',
];
const EDU_GOV = /\.(edu|gov)$|\.(edu|gov|ac)\.[a-z]{2}$/i;

export function isTrustedDomain(host) {
  const h = host.toLowerCase();
  return EDU_GOV.test(h) || TRUSTED_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Returns a normalised https URL object or null. Rejects non-https, credentials, IPs, localhost, single-label hosts. */
export function validateResourceUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host)) return null;
  u.hash = '';
  return u;
}

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function finalise(candidates, max) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const u = validateResourceUrl(c.url);
    if (!u) continue;
    const key = `${u.hostname}${u.pathname.replace(/\/$/, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = u.hostname.replace(/^www\./, '');
    out.push({
      title: stripTags(c.title) || domain,
      domain,
      description: c.description ? excerpt(stripTags(c.description), 240) : null,
      url: u.toString(),
      trusted_domain: isTrustedDomain(domain),
    });
  }
  // stable sort: trusted domains first, search-provider order otherwise preserved
  return out.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.trusted_domain) - Number(a.r.trusted_domain) || a.i - b.i).map((x) => x.r).slice(0, max);
}

function createBraveProvider({ config, fetchImpl }) {
  return async function search(query, signal) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.slice(0, 380));
    url.searchParams.set('count', '12');
    url.searchParams.set('safesearch', 'moderate');
    url.searchParams.set('text_decorations', 'false');
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': config.BRAVE_API_KEY }, signal });
    if (!res.ok) throw new Error(`Brave search HTTP ${res.status}`);
    const json = await res.json();
    return (json?.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, description: r.description }));
  };
}

const VERTEX_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

function createGeminiGroundingProvider({ config, client, fetchImpl, logger }) {
  /** Grounding returns Google redirect URLs. Follow exactly ONE hop with redirect:manual and read Location; never fetch the destination. */
  async function resolveRedirect(uri, signal) {
    let u;
    try { u = new URL(uri); } catch { return null; }
    if (u.hostname !== VERTEX_REDIRECT_HOST) return uri;
    try {
      const res = await fetchImpl(u, { method: 'GET', redirect: 'manual', signal });
      const loc = res.headers.get('location');
      return loc && /^https:\/\//i.test(loc) ? loc : null;
    } catch {
      return null;
    }
  }

  return async function search(query, signal) {
    const model = config.SEARCH_MODEL;
    const res = await client.models.generateContent({
      model,
      contents: `List reputable educational web pages (university course material, official documentation, established reference or learning sites) that help a student study this topic: ${query}`,
      config: { tools: [{ googleSearch: {} }], temperature: 0, maxOutputTokens: 400, abortSignal: signal },
    });
    const gm = res?.candidates?.[0]?.groundingMetadata;
    const chunks = gm?.groundingChunks ?? [];
    const supports = gm?.groundingSupports ?? [];
    const snippetFor = (idx) => supports.find((s) => s.groundingChunkIndices?.includes(idx))?.segment?.text;
    const resolved = await Promise.all(
      chunks.map(async (c, idx) => {
        if (!c?.web?.uri) return null;
        const url = await resolveRedirect(c.web.uri, signal);
        return url ? { url, title: c.web.title, description: snippetFor(idx) } : null;
      }),
    );
    logger?.debug({ chunks: chunks.length, resolved: resolved.filter(Boolean).length }, 'grounding chunks resolved');
    return resolved.filter(Boolean);
  };
}

/**
 * External study resources. NEVER throws: failure is reported as status 'error' so the document-grounded
 * answer is unaffected. status: ok | empty | error | disabled
 */
export function createResourceSearchService({ config, logger, client, fetchImpl = fetch }) {
  const log = logger.child({ svc: 'resources' });
  let provider = null;
  if (config.SEARCH_PROVIDER === 'brave') provider = createBraveProvider({ config, fetchImpl });
  else if (config.SEARCH_PROVIDER === 'gemini') provider = createGeminiGroundingProvider({ config, client, fetchImpl, logger: log });

  async function findResources(query, parentSignal) {
    if (!provider) return { resources: [], status: 'disabled' };
    try {
      const raw = await runWithTimeout((signal) => provider(query, signal), {
        timeoutMs: config.RESOURCE_SEARCH_TIMEOUT_MS,
        parentSignal,
        model: config.SEARCH_PROVIDER,
      });
      const resources = finalise(raw, config.MAX_RESOURCES);
      return { resources, status: resources.length ? 'ok' : 'empty' };
    } catch (err) {
      log.warn({ provider: config.SEARCH_PROVIDER, kind: err.kind, message: err.cause?.message ?? err.message }, 'resource search failed');
      return { resources: [], status: 'error' };
    }
  }

  return { findResources };
}
