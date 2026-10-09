import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const COOKIE = 'omniprep_sid';
const HEADER = 'x-omniprep-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Anonymous *prototype session* - NOT user authentication. The server mints a random owner id and signs it.
 * It isolates one browser's documents/conversations from another's; anyone holding the token can act as that
 * session, and clearing it orphans the data. Real auth (user ids) should replace owner_id later.
 */
export function createSessionMiddleware(config) {
  const sign = (id) => `${id}.${createHmac('sha256', config.SESSION_SECRET).update(id).digest('base64url')}`;
  const verify = (token) => {
    if (typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i < 0) return null;
    const id = token.slice(0, i);
    if (!UUID.test(id)) return null;
    const expected = Buffer.from(sign(id));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  };
  const parseCookie = (header) => {
    for (const part of (header ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  };

  return function session(req, res, next) {
    let id = verify(parseCookie(req.headers.cookie)) ?? verify(req.headers[HEADER]);
    if (!id) {
      id = randomUUID();
      const token = sign(id);
      res.cookie(COOKIE, token, {
        httpOnly: true,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        maxAge: 365 * 24 * 3600 * 1000,
        path: '/',
      });
      res.setHeader('X-OmniPrep-Session', token); // fallback for browsers that block third-party cookies
    }
    req.ownerId = id;
    next();
  };
}
