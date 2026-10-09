import { ExternalLink, Globe, Loader2 } from "lucide-react";
import type { StudyResource } from "@/lib/api/types";

export function StudyResourcesPanel({
  resources,
  loading,
  error,
  asked,
}: {
  resources: StudyResource[];
  loading: boolean;
  error: string | null;
  asked: boolean;
}) {
  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Finding resources…
      </p>
    );
  if (error) return <p className="border-2 border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>;
  if (!resources.length)
    return (
      <div className="border-2 border-dashed border-input p-4 text-center">
        <Globe className="mx-auto h-5 w-5 text-lavender" aria-hidden />
        <p className="mt-2 font-mono-retro text-lg text-muted-foreground">
          {asked ? "No related links found for this question." : "Ask a question to discover related links."}
        </p>
      </div>
    );

  return (
    <ul className="space-y-3">
      {resources.map((r) => (
        <li key={r.url}>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block border-2 border-input bg-surface-2 p-3 transition-colors hover:border-primary"
          >
            <div className="flex items-center gap-2">
              {r.faviconUrl ? (
                <img src={r.faviconUrl} alt="" width={16} height={16} className="h-4 w-4" loading="lazy" />
              ) : (
                <Globe className="h-4 w-4 text-primary" aria-hidden />
              )}
              <span className="truncate font-mono-retro text-base text-primary">{r.domain}</span>
              <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
            </div>
            <p className="mt-1.5 text-sm font-medium leading-snug">{r.title}</p>
            {r.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{r.description}</p>}
          </a>
        </li>
      ))}
    </ul>
  );
}
