import { Router } from 'express';
import { z } from 'zod';

const chatBody = z.object({
  // Accept either 'message' or 'question'
  message: z.string().trim().min(1, 'message is required').max(4000, 'message must be at most 4000 characters').optional(),
  question: z.string().trim().min(1, 'question is required').max(4000, 'question must be at most 4000 characters').optional(),
  
  // Accept either 'conversation_id' or 'conversationId'
  conversation_id: z.string().uuid('conversation_id must be a UUID').nullish(),
  conversationId: z.string().uuid('conversationId must be a UUID').nullish(),
  
  // Accept either 'document_ids' or 'documentIds'
  document_ids: z.array(z.string().uuid('document_ids must be UUIDs')).max(50).optional(),
  documentIds: z.array(z.string().uuid('documentIds must be UUIDs')).max(50).optional(),
  
  // Allow optional chat history sent by frontend
  history: z.array(z.any()).optional(),
}).refine((data) => Boolean(data.message || data.question), {
  message: 'Either message or question is required',
  path: ['message'],
});

export function chatRouter({ rag, chatLimiter }) {
  const r = Router();
  r.post('/', chatLimiter, async (req, res) => {
    const body = chatBody.parse(req.body ?? {});

    // Normalize field mappings
    const message = (body.message || body.question)?.trim();
    const conversationId = body.conversationId ?? body.conversation_id ?? null;
    const documentIds = body.documentIds ?? body.document_ids;

    // Abort in-flight Gemini/search work if the client goes away before we respond.
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

    const out = await rag.answer({
      ownerId: req.ownerId,
      message,
      conversationId,
      documentIds,
      signal: ctrl.signal,
      requestId: req.id,
    });
    res.json(out);
  });
  return r;
}