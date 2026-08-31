import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, History, RefreshCw } from "lucide-react";
import {
  listScheduledTaskHistory,
  type ScheduledTaskHistoryOccurrence,
} from "@/lib/scheduled-task-history.functions";

export function ScheduledTaskHistoryPanel({ taskId }: { taskId: string }) {
  const loadHistory = useServerFn(listScheduledTaskHistory);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ScheduledTaskHistoryOccurrence[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await loadHistory({ data: { taskId } }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Scheduled task history could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [loadHistory, taskId]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items.length === 0 && !loading) await refresh();
  };

  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={open}
        >
          <History className="h-3.5 w-3.5" />
          Execution history
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {open ? (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-2" aria-live="polite">
          {error ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
              role="alert"
            >
              {error}
            </div>
          ) : loading && items.length === 0 ? (
            <div className="text-xs text-muted-foreground">Loading execution history…</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-muted-foreground">No execution occurrences yet.</div>
          ) : (
            items.map((occurrence) => (
              <div
                key={occurrence.id}
                className="rounded-lg border border-border/70 bg-background p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">
                    {occurrence.status.replaceAll("_", " ")}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(occurrence.scheduledFor).toLocaleString()}
                  </span>
                  {occurrence.manualRetryOf ? (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[11px]">
                      manual retry
                    </span>
                  ) : null}
                  {occurrence.missedCount > 0 ? (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[11px]">
                      {occurrence.missedCount} missed coalesced
                    </span>
                  ) : null}
                </div>

                {occurrence.resultSummary ? (
                  <p className="mt-2 line-clamp-3 text-muted-foreground">
                    {occurrence.resultSummary}
                  </p>
                ) : occurrence.safeError ? (
                  <p className="mt-2 text-muted-foreground">{occurrence.safeError}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>
                    Attempts: {occurrence.attempts.length || 0}
                    {occurrence.attempts.length
                      ? ` · ${occurrence.attempts.map((attempt) => `#${attempt.number} ${attempt.status.replaceAll("_", " ")}`).join(", ")}`
                      : ""}
                  </span>
                  {occurrence.deliveries.map((delivery) => (
                    <span key={delivery.id}>
                      {delivery.channel}: {delivery.status.replaceAll("_", " ")}
                      {delivery.attemptCount > 1 ? ` (${delivery.attemptCount} tries)` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
