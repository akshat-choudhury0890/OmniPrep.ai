import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFileType, decodeText, parseDocument, ProcessingError } from '../src/services/documentParser.js';
import { sanitizeFilename, cleanText } from '../src/utils/text.js';
import { makePdf } from './helpers.js';

const pdfHead = makePdf(['hello world this is a pdf']).subarray(0, 1024);

test('detectFileType: accepts genuine pdf/txt, ignores generic mime', () => {
  assert.equal(detectFileType({ head: pdfHead, ext: 'pdf', mime: 'application/pdf' }), 'pdf');
  assert.equal(detectFileType({ head: pdfHead, ext: 'pdf', mime: 'application/octet-stream' }), 'pdf');
  assert.equal(detectFileType({ head: Buffer.from('plain notes'), ext: 'txt', mime: 'text/plain; charset=utf-8' }), 'txt');
  assert.equal(detectFileType({ head: Buffer.from('plain notes'), ext: 'txt', mime: '' }), 'txt');
});

test('detectFileType: rejects spoofed extension, binary-as-txt, wrong MIME, unsupported ext', () => {
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } };
  assert.equal(code(() => detectFileType({ head: Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), ext: 'pdf', mime: 'application/pdf' })), 'FILE_CONTENT_MISMATCH');
  assert.equal(code(() => detectFileType({ head: pdfHead, ext: 'txt', mime: 'text/plain' })), 'FILE_CONTENT_MISMATCH');
  assert.equal(code(() => detectFileType({ head: Buffer.from([0x89, 0x50, 0x00, 0x00]), ext: 'txt', mime: 'text/plain' })), 'FILE_CONTENT_MISMATCH');
  assert.equal(code(() => detectFileType({ head: pdfHead, ext: 'pdf', mime: 'image/png' })), 'MIME_MISMATCH');
  assert.equal(code(() => detectFileType({ head: Buffer.from('x'), ext: 'exe', mime: '' })), 'UNSUPPORTED_FILE_TYPE');
});

test('decodeText: UTF-8, BOM, UTF-16 LE/BE and Windows-1252 fallback', () => {
  assert.equal(decodeText(Buffer.from('héllo ✓', 'utf8')), 'héllo ✓');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom ok')])), 'bom ok');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('utf16 le', 'utf16le')])), 'utf16 le');
  const be = Buffer.from('utf16 be', 'utf16le'); be.swap16();
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), 'utf16 be');
  assert.equal(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9])), 'café'); // invalid UTF-8 -> cp1252
});

test('cleanText strips NUL (Postgres-unsafe) and normalises whitespace', () => {
  assert.equal(cleanText('a\u0000b  \t c\r\n\r\n\r\n\r\nd'), 'ab c\n\nd');
});

test('sanitizeFilename removes paths/control chars and recovers UTF-8 names', () => {
  assert.equal(sanitizeFilename('../../etc/passwd.txt'), 'passwd.txt');
  assert.equal(sanitizeFilename('C:\\Users\\me\\notes<1>.pdf'), 'notes_1_.pdf');
  assert.equal(sanitizeFilename(Buffer.from('résumé.pdf', 'utf8').toString('latin1')), 'résumé.pdf');
  assert.ok(sanitizeFilename('a'.repeat(400) + '.pdf').length <= 200);
});

test('parseDocument(pdf): per-page text with page numbers', async () => {
  const buf = makePdf(['Newton second law states force equals mass times acceleration.', 'Thermodynamics studies heat, work and entropy in systems.']);
  const { pages, pageCount } = await parseDocument({ type: 'pdf', buffer: buf, maxPages: 10 });
  assert.equal(pageCount, 2);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2]);
  assert.match(pages[0].text, /Newton second law/);
  assert.match(pages[1].text, /entropy/);
});

test('parseDocument(pdf): image-only pages yield no text (caller reports "scanned")', async () => {
  const { pages } = await parseDocument({ type: 'pdf', buffer: makePdf(['', '']), maxPages: 10 });
  assert.equal(pages.reduce((n, p) => n + p.text.length, 0), 0);
});

test('parseDocument(pdf): corrupt and over-long PDFs raise user-safe ProcessingError', async () => {
  const corrupt = Buffer.from('%PDF-1.4\nthis is not really a pdf at all\n%%EOF');
  await assert.rejects(parseDocument({ type: 'pdf', buffer: corrupt, maxPages: 10 }), ProcessingError);
  await assert.rejects(parseDocument({ type: 'pdf', buffer: makePdf(['a one', 'b two', 'c three']), maxPages: 2 }), /limit is 2/);
});

test('parseDocument(txt): single page with null page number', async () => {
  const { pages, pageCount } = await parseDocument({ type: 'txt', buffer: Buffer.from('Some notes\nabout waves.'), maxPages: 10 });
  assert.equal(pageCount, null);
  assert.deepEqual(pages, [{ pageNumber: null, text: 'Some notes\nabout waves.' }]);
});
