import type {
  ApiErrorBody,
  ChatRequest,
  ChatResponse,
  DeleteDocumentResponse,
  ListDocumentsResponse,
  UploadDocumentsResponse,
} from "./types";

const RAW_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");
export const isApiConfigured = API_BASE_URL.length > 0;

const SESSION_KEY = "omniprep_session";
const SESSION_HEADER = "X-OmniPrep-Session";

const getToken = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};
const saveToken = (t: string | null) => {
  if (!t) return;
  try {
    localStorage.setItem(SESSION_KEY, t);
  } catch {
    /* storage blocked */
  }
};

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${res.status})`,
      err?.code ?? "HTTP_ERROR",
      res.status,
    );
  }
  return body as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiError(
      "Backend not configured. Set VITE_API_BASE_URL to your Express server.",
      "NOT_CONFIGURED",
      0,
    );
  }
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set(SESSION_HEADER, token);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...init, headers });
  } catch {
    throw new ApiError("Can't reach the OmniPrep server. Check your connection.", "NETWORK", 0);
  }
  saveToken(res.headers.get(SESSION_HEADER));
  return parse<T>(res);
}

/**
 * The backend currently answers /api/chat in snake_case
 * ({ response, citations, study_resources, ... }) while the frontend contract
 * expects camelCase ({ answer, sources, resources, ... }).
 * This adapter converts the former into the latter, and passes a
 * contract-shaped response through untouched, so it keeps working
 * once the backend is fixed.
 */
interface RawCitation {
  chunk_id?: string;
  document_id?: string;
  document_name?: string;
  page_number?: number | null;
  chunk_index?: number;
  chunk_text?: string;
  similarity_score?: number;
}

interface RawChatResponse {
  // snake_case shape (current backend)
  response?: string;
  citations?: RawCitation[];
  study_resources?: unknown[];
  study_resources_status?: string;
  grounding_status?: string;
  model_used?: string;
  // contract shape (future backend)
  answer?: string;
}

function normalizeChat(raw: RawChatResponse | null): ChatResponse {
  if (raw && typeof raw.answer === "string") return raw as unknown as ChatResponse;

  const citations = raw?.citations ?? [];
  const adapted = {
    answer: raw?.response ?? "",
    grounded: raw?.grounding_status === "supported",
    insufficientContext: citations.length === 0,
    sources: citations.map((c) => ({
      id: c.chunk_id ?? "",
      documentId: c.document_id ?? "",
      filename: c.document_name ?? "Unknown document",
      pageNumber: c.page_number ?? null,
      chunkIndex: c.chunk_index ?? 0,
      snippet: c.chunk_text ?? "",
      score: c.similarity_score ?? 0,
    })),
    resources: raw?.study_resources ?? [],
    resourcesError:
      raw?.study_resources_status === "error" ? "Study links are unavailable right now." : null,
    model: raw?.model_used ?? "",
  };
  return adapted as unknown as ChatResponse;
}

export const api = {
  listDocuments: () => request<ListDocumentsResponse>("/api/documents"),

  deleteDocument: (id: string) =>
    request<DeleteDocumentResponse>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  chat: async (body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> => {
    const raw = await request<RawChatResponse | null>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    return normalizeChat(raw);
  },

  /** Multipart upload with real progress via XHR (fetch has no upload progress). */
  uploadDocuments: (files: File[], onProgress?: (pct: number) => void) =>
    new Promise<UploadDocumentsResponse>((resolve, reject) => {
      if (!isApiConfigured) {
        reject(new ApiError("Backend not configured. Set VITE_API_BASE_URL.", "NOT_CONFIGURED", 0));
        return;
      }
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/api/documents/upload`);
      xhr.withCredentials = true;
      const token = getToken();
      if (token) xhr.setRequestHeader(SESSION_HEADER, token);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onerror = () => reject(new ApiError("Upload failed: server unreachable.", "NETWORK", 0));
      xhr.onload = () => {
        saveToken(xhr.getResponseHeader(SESSION_HEADER));
        parse<UploadDocumentsResponse>(
          new Response(xhr.responseText || null, { status: xhr.status }),
        ).then(resolve, reject);
      };
      xhr.send(form);
    }),
};
