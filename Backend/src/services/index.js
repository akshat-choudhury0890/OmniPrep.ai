import { createStorage } from './storageService.js';
import { createEmbeddingService } from './embeddingService.js';
import { createGeminiService } from './geminiService.js';
import { createResourceSearchService } from './resourceSearchService.js';
import { createDocumentService } from './documentService.js';
import { createRagService } from './ragService.js';
import { createQueue } from './jobQueue.js';
import { createGeminiClient } from './geminiClient.js';

/** Composition root. Tests inject a fake `geminiClient` / `fetchImpl` / `storage`; everything else is the real code. */
export function buildServices({ config, logger, db, geminiClient, fetchImpl, storage, iterativeScan = false }) {
  const client = geminiClient ?? createGeminiClient(config);
  const store = storage ?? createStorage(config);
  const queue = createQueue({ concurrency: config.PROCESSING_CONCURRENCY, logger });
  const embeddings = createEmbeddingService({ config, logger, client });
  const gemini = createGeminiService({ config, logger, client });
  const resources = createResourceSearchService({ config, logger, client, fetchImpl });
  const documents = createDocumentService({ config, db, logger, storage: store, embeddings, queue });
  const rag = createRagService({ config, db, logger, gemini, embeddings, resources, iterativeScan });
  return { client, storage: store, queue, embeddings, gemini, resources, documents, rag };
}
