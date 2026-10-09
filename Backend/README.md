# OmniPrep.ai — Backend

Express + Neon PostgreSQL (pgvector) + Google Gemini + Cloudflare R2. RAG over uploaded PDF/TXT files with structured citations, grounded-answer status, external study links, and Flash → Flash-Lite fallback.

```
Upload → validate (ext + MIME + magic bytes) → R2 → [background] parse → chunk → embed → Postgres (one transaction)
Question → (condense follow-up) → embed query → pgvector cosine kNN (owner-scoped) → threshold → Gemini (JSON schema) → answer + citations
                                  └── in parallel: external resource search (never fails the answer)
```

## Quick start (local)

```bash
cp .env.example .env            # fill DATABASE_URL, GEMINI_API_KEY, SESSION_SECRET (openssl rand -hex 32)
npm install
npm run models:check            # verifies your 3 Gemini model IDs exist for YOUR key (IDs change over time!)
npm run migrate                 # CREATE EXTENSION vector + tables + HNSW index (idempotent)
npm run dev                     # http://localhost:5000   (STORAGE_DRIVER=local stores files in ./.data/uploads)
npm test                        # see "Testing" below
```

Neon: create a project → copy the connection string into `DATABASE_URL` (pooled is fine; put the direct string in `DATABASE_URL_UNPOOLED` for migrations). `CREATE EXTENSION vector` is allowed on Neon; no manual steps.

Frontend: `VITE_API_BASE_URL=http://localhost:5000`, and **every fetch must use `credentials: 'include'`** (see "Access model").

## Configuration

All variables are in `.env.example` with comments. Startup fails fast and lists **names only** of missing/invalid variables. Key ones:

| Variable | Notes |
|---|---|
| `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_EMBEDDING_MODEL` | Never hard-coded. Defaults in `.env.example` were valid when written; confirm with `npm run models:check`. |
| `GEMINI_EMBEDDING_DIM` | Vector column size (default 768 via `outputDimensionality`; vectors are L2-normalised). Must be ≤ 2000 for HNSW. |
| `GEMINI_TIMEOUT_MS` / `GEMINI_FALLBACK_TIMEOUT_MS` | Per-attempt hard timeouts for answer generation. |
| `RAG_MIN_SIMILARITY` | Cosine floor (default 0.5). **Tune on your own documents** — below it, no model call is made. |
| `STORAGE_DRIVER` | `r2` (required when `NODE_ENV=production`) or `local` (dev only). |
| `SEARCH_PROVIDER` | `gemini` (Google Search grounding, no extra key), `brave` (`BRAVE_API_KEY`), or `none`. |
| `COOKIE_SAMESITE`/`COOKIE_SECURE` | Dev: Lax/insecure. Production: None/Secure (cross-site frontend). |

## API

All errors: `{ "success": false, "error": { "code", "message", "request_id", "details"? } }` — no stack traces. Every response has `X-Request-Id`.

### `POST /api/documents/upload` — `multipart/form-data`, field **`files`** (≤10 files, ≤25 MB each)
`201` → `{ success, documents: [{ id, filename, file_type, size_bytes, status: "PROCESSING", chunks_indexed: 0, page_count, error_message, created_at }], rejected: [{ filename, code, message, status }] }`
If *every* file is rejected: the first rejection's status (`400/413/415`) with the error format above and `details.rejected`.

### `GET /api/documents`
`200` → `{ documents: [...same shape; status PROCESSING | READY | FAILED; FAILED carries error_message], storage_used_bytes, storage_limit_bytes }`. Poll this (or `GET /api/documents/:id` → `{ document }`) while anything is `PROCESSING`.

### `POST /api/documents/:id/retry` → `202 { success, document }` (only `FAILED` documents; else `409 NOT_RETRYABLE`)
### `DELETE /api/documents/:id` → `200 { success: true, deleted_id }`
Deletes the R2 object first, then the row (chunks cascade). If storage deletion fails you get `502 STORAGE_UNAVAILABLE` and nothing is removed, so it can be retried.

### `POST /api/chat`
Request: `{ "message": "…", "conversation_id": "<uuid, omit on first message>", "document_ids": ["<uuid>", …] }` (`document_ids` optional = search all your READY documents; unknown/unowned ids → 404).

`200`:
```json
{
  "response": "…answer text…",
  "citations": [{ "document_id": "…", "document_name": "Physics.pdf", "page_number": 42, "chunk_id": "…", "chunk_index": 17,
                  "chunk_text": "≤300-char excerpt", "similarity_score": 0.812 }],
  "study_resources": [{ "title": "…", "domain": "ocw.mit.edu", "description": "…|null", "url": "https://…", "trusted_domain": true }],
  "study_resources_status": "ok | empty | error | disabled",
  "grounding_status": "supported | partial | insufficient",
  "model_used": "gemini-…|null", "fallback_used": false,
  "conversation_id": "…", "request_id": "…"
}
```
* `citations` contain only passages the model reported relying on, validated against the retrieved set; every `chunk_id` exists in `document_chunks`. `insufficient` ⇒ `citations: []`.
* If nothing clears `RAG_MIN_SIMILARITY` the model is **not called**; you get a fixed "documents do not contain enough information" message (`model_used: null`).
* `trusted_domain` = `.edu`/`.gov`/`.ac.xx` or a short curated allow-list. It is a heuristic, **not verification** — don't label it "verified" in the UI.
* `response` may contain light Markdown (`- ` lists, paragraphs); plain-text maths. A final "Beyond your documents:" paragraph marks general knowledge.
* Errors: `400 INVALID_REQUEST|INVALID_JSON`, `404`, `422 CONTENT_BLOCKED`, `429 RATE_LIMITED`, `503 MODEL_UNAVAILABLE|EMBEDDING_UNAVAILABLE` (with `Retry-After`).

### `GET /api/health`, `GET /api/health/ready` (DB, pgvector version, storage, embedding dims)

### Contract decisions (shared rule 15 — these differ from the original backend brief or the Stitch sample)
| Topic | Decision |
|---|---|
| Field names | Followed the **frontend contract** (`response`, `citations`, `study_resources`, `size_bytes`, upper-case `status`) rather than the brief's `answer/sources/relatedLinks/modelUsed/fallbackUsed`; `model_used`/`fallback_used` added. |
| IDs | Raw UUIDs (not `doc_8f92a1`); treat as opaque strings. `conversation_id` must be one the server returned. |
| Additions | `FAILED` status + `error_message`, `rejected[]`, `chunk_id`, `grounding_status`, `study_resources_status`, `trusted_domain`, `retry` + `GET :id` endpoints. |
| Sessions | Browser must send cookies (`credentials: 'include'`). |

## Access model (important limitation)
There is **no user authentication**. The server issues each browser a signed, random *prototype session* (httpOnly cookie `omniprep_sid`; also returned in the `X-OmniPrep-Session` header and accepted back in that request header for browsers that block third-party cookies). Every document/conversation row has an `owner_id`, and every query filters on it, so sessions are isolated — but anyone holding the token *is* that session, and clearing it orphans the data. `owner_id` is designed to be replaced by a real user id later. Rate limits are per IP.
State-changing requests with a non-allowed `Origin` are rejected (CSRF), CORS is limited to `FRONTEND_URL`.
**Best deployment:** serve frontend and API from one origin (Vite dev proxy locally; a Cloudflare route/proxy in prod). That avoids cross-site cookie problems entirely.

## Models, fallback and grounding
* Primary → fallback only on retryable failures: timeout, 429, 5xx, network, missing model, empty/malformed output. **Not** retried: 400 (invalid request/bad key), 401/403, safety blocks.
* Each attempt has its own timeout; on timeout the request is **aborted** (`AbortSignal`, plus a hard race so a non-cooperative SDK can't hang us). Client disconnect aborts in-flight work and does not start the fallback.
* Both models get the identical system instruction, context, and JSON response schema, so grounding and citations behave the same. Embeddings/retrieval are independent of generation fallback (own timeout + 4 retries with backoff).
* Retrieved text is wrapped in `<source>` tags with delimiter escaping; the system prompt marks it as untrusted data.

## Ingestion notes
* Types decided by content (`%PDF-` / no NUL bytes), cross-checked with extension and MIME; never by filename alone. Storage keys are server-generated (`documents/<owner>/<uuid>.<ext>`).
* PDFs parsed page by page with `pdfjs-dist`; chunks never cross pages so `page_number` is exact. TXT: BOM → strict UTF-8 → Windows-1252.
* Scanned/image-only PDFs (<100 extractable characters) end as `FAILED: … OCR is not supported`. Password-protected/corrupt PDFs fail with a clear message.
* Processing runs in an in-process queue (`PROCESSING_CONCURRENCY`). Chunks and the `READY` flip commit in one transaction (no partial chunks). Documents left `processing` by a restart are re-queued at boot — **this assumes a single API instance**; run more and you need a proper job table/queue.
* PDF parsing runs on the Node event loop; very large PDFs can briefly slow the API.

## Changing the embedding model
`npm run reembed -- --yes` (uses `DATABASE_URL_UNPOOLED` if set): resizes the vector column/index if the dimension changed, then re-reads every original from storage, re-chunks and re-embeds. Startup refuses to run if the column size or stored model differs from config, so vectors are never mixed.

## Deployment
Plain Express needs a Node host — **not** Cloudflare Workers as-is. Use Render / Railway / Fly.io / a VPS (`npm start`, `NODE_ENV=production`, `TRUST_PROXY=1`). Use Cloudflare for **R2** (create bucket + S3 API token, set the five `R2_*` vars; keep the bucket private), and Cloudflare Pages for the frontend. Run `npm run migrate` on each deploy. Health check: `/api/health/ready`. Set `FRONTEND_URL` to the exact frontend origin(s). With `cloudflared`, expose one hostname that routes `/api` to this service.

External-search privacy: the (condensed) question text is sent to Google (grounding) or Brave. Document text is never sent to search. If you use Gemini Search grounding, check Google's current terms for displaying grounded results/search suggestions; Brave avoids that.

## Testing — what was actually run
`npm test` (Node's built-in runner; Gemini is mocked, everything else is real). `tests/integration.test.js` needs PostgreSQL with pgvector at `TEST_DATABASE_URL` (default `postgresql://postgres@localhost:5433/omniprep_test`; it **drops the `public` schema**) and is skipped if unreachable.

Run when this was delivered (Node 22, PostgreSQL 16 + pgvector **0.6.0**): all suites passed — chunking, parsing (real generated PDFs, scanned/corrupt/encoding cases), file validation, env validation, primary-timeout/429/503/bad-JSON → fallback with request abort, 400/safety no-retry, both-fail 503, embedding retry/dimension checks, resource search success/failure/timeouts/URL filtering, plus 21 end-to-end HTTP tests (migration, pgvector, ingestion, retrieval ranking, traceable citations, insufficient-context, follow-ups, isolation, delete/cascade/storage-failure, retry, restart recovery, CORS/CSRF, validation, rate limiting, prompt-injection escaping). A boot smoke test of `npm run migrate` / `npm start` also passed. The real `@google/genai` SDK was exercised against a local mock server to confirm request/response shapes.

**Not verified (no network access to these in the build sandbox):** live Gemini calls (model IDs, real embedding similarity scores → tune `RAG_MIN_SIMILARITY`), live Google Search grounding / redirect resolution, live Brave search, real Cloudflare R2 and Neon, `pgvector ≥ 0.8` iterative-scan path (code path exists, untested; Neon ships ≥ 0.8), and `npm run reembed`/`models:check` end to end.
