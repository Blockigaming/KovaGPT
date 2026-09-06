import { Globe, Loader2 } from "lucide-react";
import type { Message } from "@/lib/chat-store";

export function ResearchProgressCard({
  progress,
}: {
  progress: NonNullable<Message["researchProgress"]>;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, progress.progress)) * 100);
  const terminal =
    progress.status === "complete" ||
    progress.status === "failed" ||
    progress.status === "canceled";
  const statusLabel =
    progress.status === "failed"
      ? "Research failed"
      : progress.status === "canceled"
        ? "Research canceled"
        : progress.status === "complete"
          ? "Research complete"
          : `${percent}% complete`;

  return (
    <section
      className={`mb-3 rounded-2xl border p-3.5 ${
        progress.status === "failed"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-accent/20"
      }`}
      aria-label="Deep Research progress"
      data-testid="research-progress"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-1.5 text-primary" aria-hidden="true">
          {progress.status === "failed" ? (
            <span className="flex h-4 w-4 items-center justify-center text-sm font-semibold text-destructive">
              !
            </span>
          ) : terminal ? (
            <Globe className="h-4 w-4" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-foreground">{progress.label}</p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {statusLabel}
            </span>
          </div>
          {progress.detail && (
            <p className="mt-0.5 text-xs text-muted-foreground">{progress.detail}</p>
          )}
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Deep Research completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${progress.status === "failed" ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
      {progress.warnings?.map((warning, index) => (
        <div
          key={`${warning}-${index}`}
          className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          <span
            className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center font-semibold"
            aria-hidden="true"
          >
            !
          </span>
          <span>{warning}</span>
        </div>
      ))}
    </section>
  );
}
