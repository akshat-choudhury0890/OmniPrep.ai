/** Remove characters PostgreSQL TEXT cannot store (NUL), fix lone surrogates, normalise whitespace. */
export function cleanText(input) {
  if (!input) return '';
  let s = String(input).replace(/\u0000/g, '');
  if (typeof s.toWellFormed === 'function') s = s.toWellFormed();
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Display-safe filename: no path parts, no control chars, bounded length. */
export function sanitizeFilename(name) {
  let n = String(name ?? 'document');
  // busboy decodes multipart filenames as latin1; recover UTF-8 names when they round-trip cleanly
  if ([...n].every((ch) => ch.charCodeAt(0) <= 0xff)) {
    const utf8 = Buffer.from(n, 'latin1').toString('utf8');
    if (!utf8.includes('\ufffd')) n = utf8;
  }
  n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  if (n.length > 200) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot) : '';
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n || 'document';
}

export const excerpt = (s, max = 300) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
