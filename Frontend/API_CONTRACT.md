# OmniPrep.ai — Shared API Contract (v1)

Frontend and Express backend MUST agree on this contract. TypeScript source of truth for the frontend: `src/lib/api/types.ts`.

- Base URL: `VITE_API_BASE_URL` (e.g. `http://localhost:4000`). All paths below are relative to it.
- JSON uses camelCase. Timestamps are ISO 8601 UTC strings.
- CORS: backend must allow the frontend origin, with `credentials: true` (frontend sends `credentials: "include"` so a future session cookie works without UI changes).
- The browser never receives Gemini, Neon, R2 or search-provider secrets.

## Error envelope (all non-2xx responses)

```json
{ "error": { "code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF and TXT files are supported.", "details": {} } }
```

`message` is shown to users verbatim — keep it human-readable. Suggested codes:
`VALIDATION_ERROR` 400 · `UNSUPPORTED_FILE_TYPE` 415 · `FILE_TOO_LARGE` 413 · `NOT_FOUND` 404 · `NO_READY_DOCUMENTS` 409 · `RATE_LIMITED` 429 · `AI_UNAVAILABLE` 503 · `INTERNAL_ERROR` 500.

## Document object

```json
{
  "id": "doc_8f2c…",
  "filename": "physics-notes.pdf",
  "fileType": "pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "status": "processing",
  "error": null,
  "pageCount": 12,
  "chunkCount": null,
  "createdAt": "2026-10-09T08:00:00.000Z",
  "updatedAt": "2026-10-09T08:00:02.000Z"
}
```

| field | type | notes |
|---|---|---|
| status | `"uploading" \| "processing" \| "ready" \| "failed"` | Only `ready` docs are searchable. |
| error | string \| null | Human-readable reason when `failed`. |
| pageCount | number \| null | null for TXT or before parsing. |
| chunkCount | number \| null | Set once embedded. |

## `GET /api/documents`

200:
```json
{ "documents": [Document, ...] }
```
Sorted newest first. The frontend polls this every 3 s while any document is `uploading`/`processing`.

## `POST /api/documents/upload`

Request: `multipart/form-data`, one or more parts named **`files`**. Accepted: `.pdf` (`application/pdf`), `.txt` (`text/plain`). Max 20 MB per file (frontend pre-checks; backend enforces).

The original file is stored in object storage (Cloudflare R2 in production). Parsing/embedding happens asynchronously — respond as soon as files are stored.

201:
```json
{
  "documents": [ { "...Document": "", "status": "processing" } ],
  "rejected": [ { "filename": "slides.pptx", "code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF and TXT files are supported." } ]
}
```
If every file is rejected, return 4xx with the error envelope instead.

## `DELETE /api/documents/:id`

Deletes the DB row, its chunks/embeddings and the stored object.

200:
```json
{ "id": "doc_8f2c…", "deleted": true }
```
404 `NOT_FOUND` if missing. The UI removes the item only after 200.

## `POST /api/chat`

Request:
```json
{
  "question": "What is Newton's second law?",
  "history": [
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "…" }
  ],
  "documentIds": ["doc_8f2c…"]
}
```
- `question`: required, 1–4000 chars.
- `history`: last ≤10 turns, oldest first; may be empty.
- `documentIds`: optional; omit or empty = search all `ready` documents.

200:
```json
{
  "answer": "**Newton's second law** states that $F = ma$ …[1]",
  "grounded": true,
  "insufficientContext": false,
  "sources": [
    {
      "id": "chunk_91a…",
      "documentId": "doc_8f2c…",
      "filename": "physics-notes.pdf",
      "pageNumber": 4,
      "chunkIndex": 17,
      "snippet": "The acceleration of an object is directly proportional…",
      "score": 0.83
    }
  ],
  "resources": [
    {
      "title": "Newton's laws of motion",
      "url": "https://en.wikipedia.org/wiki/Newton%27s_laws_of_motion",
      "domain": "en.wikipedia.org",
      "description": "Overview of the three laws…",
      "faviconUrl": null
    }
  ],
  "resourcesError": null,
  "model": "gemini-2.5-flash"
}
```

Rules:
- `answer` is Markdown (GFM). Math: `$inline$` and `$$block$$`. Inline citation markers `[n]` refer to `sources[n-1]`.
- `sources` come only from retrieved chunks actually passed to the model. Never invent filenames or page numbers — use `null` when unknown.
- `insufficientContext: true` when retrieval found nothing relevant enough; the answer must say so rather than guess. `grounded` = answer is backed by ≥1 source.
- `resources` come only from a real search provider; return `[]` if none. If the search call fails but the answer succeeds, return `resources: []` and a human-readable `resourcesError`.
- `model` is the Gemini model that actually produced the answer (primary Flash or Flash-Lite fallback).
- No ready documents → 409 `NO_READY_DOCUMENTS`.

## Backend environment (never exposed to the browser)

`DATABASE_URL` (Neon, pgvector) · `GEMINI_API_KEY` · `GEMINI_MODEL_PRIMARY` (e.g. `gemini-2.5-flash`) · `GEMINI_MODEL_FALLBACK` (e.g. `gemini-2.5-flash-lite`) · `GEMINI_EMBEDDING_MODEL` (e.g. `gemini-embedding-001`) · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `SEARCH_API_KEY` · `CORS_ORIGIN`.
