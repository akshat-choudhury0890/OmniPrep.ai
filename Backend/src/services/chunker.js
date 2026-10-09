const MIN_CHUNK_CHARS = 15;

function findCut(text, start, end, size) {
  const minEnd = start + Math.floor(size * 0.6);
  const win = text.slice(minEnd, end);
  const para = win.lastIndexOf('\n\n');
  if (para >= 0) return minEnd + para + 2;
  let last = -1;
  for (const m of win.matchAll(/[.!?][)"'\]]*\s/g)) last = m.index + m[0].length;
  if (last > 0) return minEnd + last;
  const nl = win.lastIndexOf('\n');
  if (nl >= 0) return minEnd + nl + 1;
  const sp = win.lastIndexOf(' ');
  if (sp >= 0) return minEnd + sp + 1;
  return -1;
}

/** Split one text into overlapping windows, preferring paragraph > sentence > word boundaries. */
export function splitText(text, { size, overlap }) {
  if (overlap >= size) throw new Error('overlap must be smaller than size');
  const out = [];
  const n = text.length;
  let start = 0;
  while (start < n) {
    let end = Math.min(start + size, n);
    if (end < n) {
      const cut = findCut(text, start, end, size);
      if (cut > start) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece.replace(/\s/g, '').length >= MIN_CHUNK_CHARS) out.push(piece);
    if (end >= n) break;
    let next = end - overlap;
    if (next <= start) next = end;
    // don't start a chunk mid-word
    if (next > 0 && !/\s/.test(text[next - 1])) {
      const ws = text.slice(next, next + 60).search(/\s/);
      if (ws >= 0) next += ws + 1;
    }
    start = next > start ? next : end;
  }
  return out;
}

/** pages: [{ pageNumber: number|null, text }] -> [{ chunkIndex, pageNumber, content }]. Chunks never span pages. */
export function chunkPages(pages, opts) {
  const chunks = [];
  for (const p of pages) {
    for (const content of splitText(p.text, opts)) {
      chunks.push({ chunkIndex: chunks.length, pageNumber: p.pageNumber ?? null, content });
    }
  }
  return chunks;
}
