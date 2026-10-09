import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import type { StudyDocument } from "@/lib/api/types";
import { documentsKey, useDeleteDocument, useDocuments } from "@/hooks/use-documents";

const ACCEPT = [".pdf", ".txt"];
const MAX_MB = 20;

interface UploadJob {
  key: string;
  names: string[];
  progress: number;
  error: string | null;
}

function isSupported(f: File) {
  const n = f.name.toLowerCase();
  return ACCEPT.some((ext) => n.endsWith(ext));
}

export function DocumentUploader() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    const existing = new Set(
      (qc.getQueryData<StudyDocument[]>(documentsKey) ?? []).map((d) => `${d.filename}:${d.sizeBytes}`),
    );
    const warn: string[] = [];
    const seen = new Set<string>();
    const files = all.filter((f) => {
      const sig = `${f.name}:${f.size}`;
      if (!isSupported(f)) return warn.push(`${f.name}: only PDF or TXT files are supported.`), false;
      if (f.size > MAX_MB * 1024 * 1024) return warn.push(`${f.name}: larger than ${MAX_MB} MB.`), false;
      if (existing.has(sig) || seen.has(sig)) return warn.push(`${f.name}: already uploaded.`), false;
      seen.add(sig);
      return true;
    });
    setWarnings(warn);
    if (!files.length) return;

    const key = crypto.randomUUID();
    setJobs((j) => [...j, { key, names: files.map((f) => f.name), progress: 0, error: null }]);
    try {
      const res = await api.uploadDocuments(files, (p) =>
        setJobs((j) => j.map((x) => (x.key === key ? { ...x, progress: p } : x))),
      );
      qc.setQueryData<StudyDocument[]>(documentsKey, (old = []) => {
        const ids = new Set(res.documents.map((d) => d.id));
        return [...res.documents, ...old.filter((d) => !ids.has(d.id))];
      });
      qc.invalidateQueries({ queryKey: documentsKey });
      if (res.rejected?.length) setWarnings((w) => [...w, ...res.rejected.map((r) => `${r.filename}: ${r.message}`)]);
      setJobs((j) => j.filter((x) => x.key !== key));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Upload failed.";
      setJobs((j) => j.map((x) => (x.key === key ? { ...x, error: msg } : x)));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 border-2 border-dashed p-5 text-center transition-colors ${
          drag ? "border-primary bg-primary/10" : "border-accent/60 bg-background/40"
        }`}
      >
        <Upload className="h-6 w-6 text-accent" aria-hidden />
        <p className="font-mono-retro text-lg text-lavender">Drop PDF or TXT files here</p>
        <button className="btn-pixel btn-cyan" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          multiple
          hidden
          aria-label="Choose PDF or TXT files"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 border-2 border-warning/60 bg-warning/10 p-2 text-xs text-warning" role="alert">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
          <li><button className="underline" onClick={() => setWarnings([])}>Dismiss</button></li>
        </ul>
      )}

      {jobs.map((j) => (
        <div key={j.key} className="mt-3 border-2 border-input bg-surface-2 p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{j.names.join(", ")}</span>
            {j.error && (
              <button aria-label="Dismiss" onClick={() => setJobs((x) => x.filter((y) => y.key !== j.key))}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {j.error ? (
            <p className="mt-1 text-destructive">{j.error}</p>
          ) : (
            <>
              <p className="mt-1 font-pixel text-[0.55rem] text-primary">Uploading {j.progress}%</p>
              <div className="mt-1 h-2 bg-background" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary transition-all" style={{ width: `${j.progress}%` }} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<StudyDocument["status"], string> = {
  uploading: "text-primary border-primary",
  processing: "text-warning border-warning",
  ready: "text-success border-success",
  failed: "text-destructive border-destructive",
};

export function DocumentList({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { data, isLoading, error, refetch } = useDocuments();
  const del = useDeleteDocument();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (isLoading)
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading documents…</p>;
  if (error)
    return (
      <div className="border-2 border-destructive/70 bg-destructive/10 p-3 text-sm" role="alert">
        <p className="flex items-start gap-2 text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{(error as Error).message}</p>
        <button className="mt-2 underline text-xs" onClick={() => refetch()}>Retry</button>
      </div>
    );
  if (!data?.length)
    return (
      <div className="border-2 border-dashed border-input p-4 text-center">
        <p className="font-mono-retro text-lg text-muted-foreground">No documents yet.</p>
        <p className="text-xs text-muted-foreground">Upload notes to start asking questions.</p>
      </div>
    );

  return (
    <ul className="space-y-2">
      {data.map((d) => {
        const isSel = selected.has(d.id);
        return (
          <li key={d.id} className={`border-2 bg-surface-2 p-2.5 transition-colors ${isSel ? "border-primary" : "border-input"}`}>
            <div className="flex items-start gap-2">
              <button
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
                onClick={() => d.status === "ready" && onToggle(d.id)}
                aria-pressed={isSel}
                disabled={d.status !== "ready"}
                title={d.status === "ready" ? "Click to focus questions on this document" : undefined}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-lavender" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{d.filename}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-pixel text-[0.5rem] uppercase text-muted-foreground">{d.fileType}</span>
                    <span className={`border px-1 font-pixel text-[0.5rem] uppercase ${STATUS_STYLE[d.status]}`}>
                      {d.status === "processing" && <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
                      {d.status}
                    </span>
                    {d.pageCount != null && <span className="text-[0.65rem] text-muted-foreground">{d.pageCount} pages</span>}
                  </span>
                  {d.status === "failed" && d.error && <span className="mt-1 block text-xs text-destructive">{d.error}</span>}
                </span>
              </button>
              {confirmId === d.id ? (
                <span className="flex gap-1">
                  <button
                    className="border-2 border-destructive px-1.5 font-pixel text-[0.5rem] text-destructive"
                    disabled={del.isPending}
                    onClick={() => del.mutate(d.id, { onSettled: () => setConfirmId(null) })}
                  >
                    {del.isPending ? "…" : "Delete"}
                  </button>
                  <button className="px-1 text-xs" onClick={() => setConfirmId(null)} aria-label="Cancel delete"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : (
                <button className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${d.filename}`} onClick={() => setConfirmId(d.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        );
      })}
      {del.error && <li className="text-xs text-destructive" role="alert">{(del.error as Error).message}</li>}
    </ul>
  );
}

export function DocumentPanel(props: { selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-5">
      <DocumentUploader />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-pixel text-[0.6rem] text-lavender">Library</h3>
          {props.selected.size > 0 && <span className="text-xs text-primary">{props.selected.size} focused</span>}
        </div>
        <DocumentList {...props} />
      </div>
    </div>
  );
}
