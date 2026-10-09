/**
 * OmniPrep.ai shared API contract (frontend side).
 * Must stay in sync with the Express backend — see API_CONTRACT.md.
 */

export type DocumentStatus = "uploading" | "processing" | "ready" | "failed";
export type DocumentFileType = "pdf" | "txt";

export interface StudyDocument {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  mimeType: "application/pdf" | "text/plain";
  sizeBytes: number;
  status: DocumentStatus;
  /** Human-readable reason when status === "failed". */
  error: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface ListDocumentsResponse {
  documents: StudyDocument[];
}

export interface UploadDocumentsResponse {
  documents: StudyDocument[];
  /** Files the backend rejected (unsupported type, too large, ...). */
  rejected: { filename: string; code: string; message: string }[];
}

export interface DeleteDocumentResponse {
  id: string;
  deleted: true;
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  question: string;
  history: ChatHistoryItem[];
  /** Optional: restrict retrieval to these documents. Omit/empty = all ready docs. */
  documentIds?: string[];
}

export interface SourceCitation {
  id: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  chunkIndex: number;
  snippet: string;
  score: number; // similarity 0..1
}

export interface StudyResource {
  title: string;
  url: string;
  domain: string;
  description: string | null;
  faviconUrl: string | null;
}

export interface ChatResponse {
  answer: string; // Markdown (GFM + $…$ / $$…$$ LaTeX)
  grounded: boolean;
  insufficientContext: boolean;
  sources: SourceCitation[];
  resources: StudyResource[];
  /** Set when external link search failed but the answer succeeded. */
  resourcesError: string | null;
  model: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
