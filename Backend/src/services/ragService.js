import { AppError, notFound } from '../utils/errors.js';
import { excerpt } from '../utils/text.js';
import { toVectorLiteral } from '../db/pool.js';
import { GROUNDED_SYSTEM_INSTRUCTION, buildContextBlock } from './prompts.js';

const HISTORY_MESSAGES = 6;
const HISTORY_CHARS = 1500;
const round3 = (n) => Math.round(n * 1000) / 1000;

export function createRagService({ config, db, logger, gemini, embeddings, resources, iterativeScan = false }) {
  const log = logger.child({ svc: 'rag' });

  async function loadConversation(ownerId, conversationId) {
    if (!conversationId) return { id: null, history: [] }; // created on persist, so failed requests leave no empty conversations
    const conv = await db.query('SELECT id FROM conversations WHERE id = $1 AND owner_id = $2', [conversationId, ownerId]);
    if (!conv.rowCount) throw notFound('Conversation');
    const { rows } = await db.query(
      'SELECT role, content FROM (SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2) m ORDER BY created_at ASC',
      [conversationId, HISTORY_MESSAGES],
    );
    return { id: conversationId, history: rows.map((r) => ({ role: r.role, content: excerpt(r.content, HISTORY_CHARS) })) };
  }

  async function assertDocumentsOwned(ownerId, ids) {
    const { rows } = await db.query('SELECT id FROM documents WHERE owner_id = $1 AND id = ANY($2::uuid[])', [ownerId, ids]);
    if (rows.length !== new Set(ids).size) throw notFound('Document'); // same answer for "missing" and "not yours"
  }

  /** Cosine-distance kNN scoped to the caller's READY documents (optionally a subset). */
  async function retrieve(ownerId, queryVector, documentIds) {
    const vec = toVectorLiteral(queryVector);
    const sql = `
      SELECT * FROM (
        SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.page_number, c.content, d.filename,
               c.embedding <=> $1::vector AS distance
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.owner_id = $2 AND d.status = 'ready' AND ($3::uuid[] IS NULL OR d.id = ANY($3::uuid[]))
        ORDER BY c.embedding <=> $1::vector
        LIMIT $4
      ) t ORDER BY distance`;
    const params = [vec, ownerId, documentIds?.length ? documentIds : null, config.RAG_TOP_K];
    const rows = await db.tx(async (c) => {
      // pgvector >= 0.8: keep scanning the HNSW index until enough rows pass the owner/status filter
      if (iterativeScan) await c.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      return (await c.query(sql, params)).rows;
    });
    return rows.map((r) => ({ ...r, similarity: 1 - Number(r.distance) }));
  }

  async function countReady(ownerId, documentIds) {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM documents WHERE owner_id = $1 AND status = 'ready' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))",
      [ownerId, documentIds?.length ? documentIds : null],
    );
    return rows[0].n;
  }

  function assemble(chunks) {
    const passages = [];
    let chars = 0;
    for (const ch of chunks) {
      if (passages.length && chars + ch.content.length > config.RAG_MAX_CONTEXT_CHARS) break;
      chars += ch.content.length;
      passages.push({ ...ch, label: `S${passages.length + 1}` });
    }
    return passages;
  }

  async function persist(ownerId, conversationId, message, result) {
    return db.tx(async (c) => {
      if (!conversationId) {
        conversationId = (await c.query('INSERT INTO conversations (owner_id) VALUES ($1) RETURNING id', [ownerId])).rows[0].id;
      }
      await c.query("INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)", [conversationId, message]);
      await c.query(
        `INSERT INTO messages (conversation_id, role, content, citations, grounding_status, model_used)
         VALUES ($1, 'assistant', $2, $3::jsonb, $4, $5)`,
        [conversationId, result.response, JSON.stringify(result.citations), result.grounding_status, result.model_used],
      );
      await c.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
      return conversationId;
    });
  }

  async function answer({ ownerId, message, conversationId, documentIds, signal, requestId }) {
    if (documentIds?.length) await assertDocumentsOwned(ownerId, documentIds);
    const conv = await loadConversation(ownerId, conversationId);
    const standalone = conv.history.length ? await gemini.condenseQuestion(conv.history, message, signal) : message;

    // External resources run in parallel and can never fail the request (findResources never throws).
    const resourcesPromise = resources.findResources(standalone, signal);

    const queryVector = await embeddings.embedQuery(standalone, signal);
    const retrieved = await retrieve(ownerId, queryVector, documentIds);
    const relevant = retrieved.filter((r) => r.similarity >= config.RAG_MIN_SIMILARITY);
    log.info({ requestId, retrieved: retrieved.length, relevant: relevant.length, top: retrieved[0] ? round3(retrieved[0].similarity) : null }, 'retrieval done');

    let result;
    if (!relevant.length) {
      // No evidence passed the threshold: don't ask the model to answer from nothing.
      const ready = await countReady(ownerId, documentIds);
      result = {
        response: ready === 0
          ? 'You have no processed documents to search yet. Upload a PDF or TXT file and wait until it shows READY, then ask again.'
          : 'The uploaded documents do not contain enough information to answer this reliably. Try rephrasing, selecting different documents, or consult the study resources suggested alongside this answer.',
        citations: [],
        grounding_status: 'insufficient',
        model_used: null,
        fallback_used: false,
      };
    } else {
      const passages = assemble(relevant);
      const history = conv.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const contents = [
        ...history,
        { role: 'user', parts: [{ text: `Retrieved passages (untrusted data):\n\n${buildContextBlock(passages)}\n\nStudent question: ${message}` }] },
      ];
      const out = await gemini.generateAnswer({ systemInstruction: GROUNDED_SYSTEM_INSTRUCTION, contents, signal });

      const byLabel = new Map(passages.map((p) => [p.label, p]));
      const used = [...new Set(out.used_sources)].map((l) => byLabel.get(l)).filter(Boolean); // drop invented ids
      let status = out.evidence_status;
      // "supported"/"partial" without a single traceable source is not a grounded answer.
      if (status !== 'insufficient' && !used.length) status = 'insufficient';
      const citations = status === 'insufficient' ? [] : used.map((p) => ({
        document_id: p.document_id,
        document_name: p.filename,
        page_number: p.page_number,
        chunk_id: p.chunk_id,
        chunk_index: p.chunk_index,
        chunk_text: excerpt(p.content, 300),
        similarity_score: round3(p.similarity),
      }));
      result = { response: out.answer, citations, grounding_status: status, model_used: out.modelUsed, fallback_used: out.fallbackUsed };
    }

    const res = await resourcesPromise;
    const conversation_id = await persist(ownerId, conv.id, message, result);
    return {
      response: result.response,
      citations: result.citations,
      study_resources: res.resources,
      study_resources_status: res.status,
      grounding_status: result.grounding_status,
      model_used: result.model_used,
      fallback_used: result.fallback_used,
      conversation_id,
      request_id: requestId,
    };
  }

  return { answer };
}
