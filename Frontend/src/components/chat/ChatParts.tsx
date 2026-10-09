import { useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { AlertTriangle, BookMarked, ChevronDown, Info, RotateCcw } from "lucide-react";
import type { ChatResponse, SourceCitation } from "@/lib/api/types";

export type UiMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; meta: ChatResponse }
  | { id: string; role: "error"; content: string; question: string };

export function SourceReferences({ sources }: { sources: SourceCitation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!sources.length) return null;
  return (
    <div className="mt-4 border-t-2 border-dashed border-input pt-3">
      <p className="mb-2 flex items-center gap-1.5 font-pixel text-[0.55rem] text-accent">
        <BookMarked className="h-3.5 w-3.5" /> From your documents
      </p>
      <ul className="flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <li key={s.id} className="max-w-full">
            <button
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-expanded={open === s.id}
              className={`flex items-center gap-1.5 border-2 px-2 py-1 text-xs transition-colors ${
                open === s.id ? "border-accent bg-accent/15" : "border-input bg-surface-2 hover:border-accent"
              }`}
            >
              <span className="font-pixel text-[0.5rem] text-accent">[{i + 1}]</span>
              <span className="max-w-[12rem] truncate">{s.filename}</span>
              {s.pageNumber != null && <span className="text-muted-foreground">p.{s.pageNumber}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open && (() => {
        const s = sources.find((x) => x.id === open)!;
        return (
          <div className="mt-2 border-2 border-accent/60 bg-background/60 p-3 text-xs">
            <p className="font-medium text-lavender">
              {s.filename}
              {s.pageNumber != null ? ` · page ${s.pageNumber}` : ""} · passage {s.chunkIndex + 1} · match {(s.score * 100).toFixed(0)}%
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">“{s.snippet}”</p>
          </div>
        );
      })()}
    </div>
  );
}

export function ChatMessage({ msg, onRetry }: { msg: UiMessage; onRetry?: (q: string) => void }) {
  if (msg.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] border-2 border-primary bg-primary px-4 py-2.5 text-primary-foreground shadow-[3px_3px_0_0_var(--color-background)]">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );

  if (msg.role === "error")
    return (
      <div className="flex gap-3" role="alert">
        <div className="max-w-[85%] border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{msg.content}</p>
          {onRetry && (
            <button className="mt-2 flex items-center gap-1 text-xs underline" onClick={() => onRetry(msg.question)}>
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
        </div>
      </div>
    );

  const m = msg.meta;
  return (
    <div className="flex gap-3">
      <BotAvatar />
      <div className="min-w-0 flex-1">
        {m.insufficientContext && (
          <p className="mb-2 flex items-start gap-2 border-2 border-warning/70 bg-warning/10 px-3 py-2 text-xs text-warning">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Your documents don't contain enough information to fully answer this.
          </p>
        )}
        <div className="prose-answer">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {msg.content}
          </ReactMarkdown>
        </div>
        <SourceReferences sources={m.sources} />
      </div>
    </div>
  );
}

export function BotAvatar() {
  return (
    <svg viewBox="0 0 8 8" className="pixelated mt-1 h-8 w-8 shrink-0 border-2 border-accent bg-surface-2 p-0.5" aria-hidden shapeRendering="crispEdges">
      <rect x="1" y="2" width="6" height="5" className="fill-lavender" />
      <rect x="2" y="3" width="1" height="2" className="fill-background" />
      <rect x="5" y="3" width="1" height="2" className="fill-background" />
      <rect x="3" y="6" width="2" height="1" className="fill-accent" />
      <rect x="3" y="0" width="2" height="2" className="fill-primary" />
    </svg>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <BotAvatar />
      <p className="font-mono-retro text-lg text-lavender">
        Searching your notes<span className="animate-blink">…</span>
      </p>
    </div>
  );
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  busy,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && value.trim()) onSubmit();
    }
  };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!busy && value.trim()) onSubmit(); }}
      className="flex items-end gap-2 border-t-[3px] border-accent bg-surface p-3"
    >
      <label htmlFor="chat-input" className="sr-only">Ask a question</label>
      <textarea
        id="chat-input"
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder="Ask a question..."
        disabled={disabled}
        className="max-h-40 min-h-[2.75rem] flex-1 resize-none border-2 border-input bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <button type="submit" className="btn-pixel btn-pink h-[2.75rem]" disabled={busy || !value.trim() || disabled}>
        {busy ? "..." : "Send"}
      </button>
    </form>
  );
}

export function PanelToggleIcon({ open }: { open: boolean }) {
  return <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />;
}
