import { useEffect, useRef, useState, type ReactNode } from "react";
import { FolderOpen, Link2, PanelLeftClose, PanelRightClose, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { api, ApiError, isApiConfigured } from "@/lib/api/client";
import type { ChatHistoryItem, StudyResource } from "@/lib/api/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { DocumentPanel } from "./DocumentPanel";
import { StudyResourcesPanel } from "./StudyResourcesPanel";
import { BotAvatar, ChatInput, ChatMessage, TypingIndicator, type UiMessage } from "./ChatParts";

const EXAMPLE = "What is Newton's second law?";

function SidePanel({
  title,
  side,
  open,
  mobile,
  onClose,
  children,
}: {
  title: string;
  side: "left" | "right";
  open: boolean;
  mobile: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const CloseIcon = side === "left" ? PanelLeftClose : PanelRightClose;
  const inner = (
    <div className="flex h-full w-[min(20rem,85vw)] flex-col bg-surface lg:w-80">
      <div className="flex items-center justify-between border-b-[3px] border-accent px-4 py-3">
        <h2 className="font-pixel text-[0.7rem] text-glow-pink">{title}</h2>
        <button className="icon-btn !h-8 !w-8" onClick={onClose} aria-label={`Collapse ${title}`}>
          {mobile ? <X className="h-4 w-4" /> : <CloseIcon className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );

  if (mobile) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex" role="dialog" aria-label={title}>
        <button className="absolute inset-0 bg-background/70" onClick={onClose} aria-label="Close panel" />
        <div className={`relative h-full pb-16 ${side === "right" ? "ml-auto border-l-[3px]" : "border-r-[3px]"} border-accent`}>
          {inner}
        </div>
      </div>
    );
  }
  return (
    <aside
      aria-label={title}
      aria-hidden={!open}
      className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${open ? "w-80" : "w-0"} ${
        side === "left" ? "border-r-[3px]" : "border-l-[3px]"
      } ${open ? "border-accent" : "border-transparent"}`}
    >
      {open && inner}
    </aside>
  );
}

export function ChatPage() {
  const mobile = useIsMobile();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [resources, setResources] = useState<StudyResource[]>([]);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mobile) { setLeftOpen(false); setRightOpen(false); }
    else { setLeftOpen(true); setRightOpen(true); }
  }, [mobile]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const toggleDoc = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    const history: ChatHistoryItem[] = messages
      .filter((m): m is Exclude<UiMessage, { role: "error" }> => m.role !== "error")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((m) => [...m.filter((x) => x.role !== "error"), { id: crypto.randomUUID(), role: "user", content: question }]);
    setInput("");
    setBusy(true);
    setResourcesError(null);
    try {
      const res = await api.chat({ question, history, ...(selected.size ? { documentIds: [...selected] } : {}) });
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: res.answer, meta: res }]);
      setResources(res.resources ?? []);
      setResourcesError(res.resourcesError ?? null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
      // Roll back the user bubble and keep their question in the input.
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "user" && last.content === question) copy.pop();
        return [...copy, { id: crypto.randomUUID(), role: "error", content: msg, question }];
      });
      setInput(question);
      setResourcesError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col pb-16">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b-[3px] border-accent bg-background px-3 sm:px-5">
        {(!leftOpen || mobile) && (
          <button className="icon-btn" onClick={() => setLeftOpen(true)} aria-label="Open my documents">
            <FolderOpen className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0">
          <Logo />
          <p className="hidden truncate font-mono-retro text-base text-muted-foreground sm:block">Turn your notes into answers</p>
        </div>
        <div className="ml-auto">
          {(!rightOpen || mobile) && (
            <button className="icon-btn" onClick={() => setRightOpen(true)} aria-label="Open study resources">
              <Link2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SidePanel title="My documents" side="left" open={leftOpen} mobile={mobile} onClose={() => setLeftOpen(false)}>
          <DocumentPanel selected={selected} onToggle={toggleDoc} />
        </SidePanel>

        <main className="flex min-w-0 flex-1 flex-col">
          {!isApiConfigured && (
            <p className="border-b-2 border-warning bg-warning/10 px-4 py-2 text-xs text-warning" role="alert">
              Backend not connected — set <code>VITE_API_BASE_URL</code> to your Express server URL.
            </p>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
              {messages.length === 0 && !busy ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <div className="animate-float"><BotAvatar /></div>
                  <h2 className="mt-6 font-pixel text-sm leading-relaxed sm:text-base text-glow-pink">Hey, study buddy!</h2>
                  <p className="mt-3 max-w-md text-muted-foreground">
                    Upload your notes on the left, then ask me anything about them.
                  </p>
                  <button
                    onClick={() => setInput(EXAMPLE)}
                    className="mt-6 border-2 border-primary bg-primary/10 px-4 py-2 font-mono-retro text-lg text-primary hover:bg-primary/20"
                  >
                    Try: "{EXAMPLE}"
                  </button>
                </div>
              ) : (
                messages.map((m) => <ChatMessage key={m.id} msg={m} onRetry={send} />)
              )}
              {busy && <TypingIndicator />}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl">
            <ChatInput value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} />
          </div>
        </main>

        <SidePanel title="Study resources" side="right" open={rightOpen} mobile={mobile} onClose={() => setRightOpen(false)}>
          <p className="mb-3 text-xs text-muted-foreground">External websites — not from your documents.</p>
          <StudyResourcesPanel resources={resources} loading={busy} error={resourcesError} asked={messages.some((m) => m.role === "assistant")} />
        </SidePanel>
      </div>
    </div>
  );
}
