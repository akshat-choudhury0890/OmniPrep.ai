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
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...init });
  } catch {
    throw new ApiError("Can't reach the OmniPrep server. Check your connection.", "NETWORK", 0);
  }
  return parse<T>(res);
}

export const api = {
  listDocuments: () => request<ListDocumentsResponse>("/api/documents"),

  deleteDocument: (id: string) =>
    request<DeleteDocumentResponse>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  chat: (body: ChatRequest, signal?: AbortSignal) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
    }),

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
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onerror = () => reject(new ApiError("Upload failed: server unreachable.", "NETWORK", 0));
      xhr.onload = () => {
        parse<UploadDocumentsResponse>(
          new Response(xhr.responseText || null, { status: xhr.status }),
        ).then(resolve, reject);
      };
      xhr.send(form);
    }),
};
