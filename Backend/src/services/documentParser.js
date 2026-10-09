import { createRequire } from 'node:module';
import { AppError } from '../utils/errors.js';
import { cleanText } from '../utils/text.js';

// Polyfill browser globals for Node v24 runtime safety
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w = 1, h = 1) {
      this.width = w; this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { constructor() {} };
}

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const ALLOWED_MIME = {
  pdf: new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']),
  txt: new Set(['text/plain', 'application/octet-stream', '']),
};

/** A processing failure whose message is safe to store/show to the user. */
export class ProcessingError extends Error {}

const startsWithBytes = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

function looksLikePdf(head) {
  return head.subarray(0, 1024).includes('%PDF-');
}

/**
 * Decide the real file type from content.
 */
export function detectFileType({ head, ext, mime }) {
  const declared = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (!['pdf', 'txt'].includes(ext)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .pdf and .txt files are supported.');
  }
  if (!ALLOWED_MIME[ext].has(declared)) {
    throw new AppError(415, 'MIME_MISMATCH', `The file's declared type (${declared}) does not match a .${ext} file.`);
  }
  const isPdf = looksLikePdf(head);
  if (ext === 'pdf') {
    if (!isPdf) throw new AppError(415, 'FILE_CONTENT_MISMATCH', 'This file has a .pdf extension but its contents are not a PDF.');
    return 'pdf';
  }
  if (isPdf) throw new AppError(415, 'FILE_CONTENT_MISMATCH', 'This file has a .txt extension but contains PDF data.');
  const utf16 = startsWithBytes(head, [0xff, 0xfe]) || startsWithBytes(head, [0xfe, 0xff]);
  if (!utf16 && head.includes(0)) {
    throw new AppError(415, 'FILE_CONTENT_MISMATCH', 'This file contains binary data and is not a plain-text file.');
  }
  return 'txt';
}

/** Encoding strategy: BOM -> strict UTF-8 -> Windows-1252 fallback. */
export function decodeText(buffer) {
  if (startsWithBytes(buffer, [0xef, 0xbb, 0xbf])) return buffer.subarray(3).toString('utf8');
  if (startsWithBytes(buffer, [0xff, 0xfe])) return buffer.subarray(2).toString('utf16le');
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

async function parsePdf(buffer, maxPages) {
  try {
    const data = await pdfParse(buffer);
    if (data.numpages > maxPages) {
      throw new ProcessingError(`This PDF has ${data.numpages} pages; the limit is ${maxPages}.`);
    }
    const text = cleanText(data.text);
    return {
      pages: [{ pageNumber: 1, text }],
      pageCount: data.numpages,
    };
  } catch (err) {
    if (err instanceof ProcessingError) throw err;
    throw new ProcessingError('This PDF appears to be corrupted or invalid and could not be read.');
  }
}

/** -> { pages: [{ pageNumber: number|null, text }], pageCount: number|null } */
export async function parseDocument({ type, buffer, maxPages }) {
  if (type === 'pdf') return parsePdf(buffer, maxPages);
  const text = cleanText(decodeText(buffer));
  return { pages: [{ pageNumber: null, text }], pageCount: null };
}