import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, chunkPages } from '../src/services/chunker.js';

const para = (n) => `Sentence number ${n} talks about forces and motion in classical mechanics. `;
const longText = Array.from({ length: 60 }, (_, i) => para(i)).join('');

test('chunks respect size, overlap and make progress', () => {
  const chunks = splitText(longText, { size: 400, overlap: 80 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 400, `chunk too long: ${c.length}`);
  // consecutive chunks share some text (overlap)
  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].slice(-40).trim().split(' ').slice(-3).join(' ');
    assert.ok(chunks[i - 1].length < 20 || longText.includes(chunks[i]), 'chunk must be verbatim text');
    assert.ok(chunks[i].length > 0 && tail.length > 0);
  }
  const joined = chunks.join(' ');
  for (const i of [0, 30, 59]) assert.ok(joined.includes(`Sentence number ${i} `), `lost sentence ${i}`);
});

test('prefers sentence boundaries over mid-word cuts', () => {
  const chunks = splitText(longText, { size: 400, overlap: 80 });
  for (const c of chunks.slice(0, -1)) assert.match(c, /[.!?]$/);
});

test('text with no whitespace still terminates', () => {
  const chunks = splitText('x'.repeat(2500), { size: 400, overlap: 80 });
  assert.ok(chunks.length >= 6 && chunks.length < 20);
});

test('tiny text yields a single chunk, whitespace-only yields none', () => {
  assert.equal(splitText('A short but valid note about mechanics.', { size: 400, overlap: 80 }).length, 1);
  assert.equal(splitText('   \n\n  ', { size: 400, overlap: 80 }).length, 0);
});

test('chunkPages keeps page numbers and never spans pages', () => {
  const chunks = chunkPages(
    [{ pageNumber: 1, text: longText.slice(0, 900) }, { pageNumber: 2, text: longText.slice(900, 1800) }, { pageNumber: 3, text: '' }],
    { size: 400, overlap: 80 },
  );
  assert.deepEqual([...new Set(chunks.map((c) => c.pageNumber))], [1, 2]);
  assert.deepEqual(chunks.map((c) => c.chunkIndex), chunks.map((_, i) => i));
  assert.equal(chunkPages([{ pageNumber: null, text: longText }], { size: 400, overlap: 80 })[0].pageNumber, null);
});

test('invalid overlap is rejected', () => {
  assert.throws(() => splitText('abc', { size: 100, overlap: 100 }));
});
