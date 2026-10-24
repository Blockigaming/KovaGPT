import { taskRunStatusLabel } from "@/lib/scheduled-task-run-labels";
import { formatDisplayDateTime, type TimeFormatPreference } from "@/lib/time-format";
import type { TaskRunPreview } from "@/lib/scheduled-task-run-page";

export function ScheduledTaskLastRun({
  preview,
  timeFormat,
  lastRunAt,
  lastResult,
}: {
  preview?: TaskRunPreview;
  timeFormat: TimeFormatPreference;
  lastRunAt?: string | null;
  lastResult?: string | null;
}) {
  if (preview?.kind === "run")
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Last run: {taskRunStatusLabel(preview.status)}
        {preview.at ? ` · ${formatDisplayDateTime(preview.at, timeFormat)}` : ""}
        {preview.summary ? ` · ${preview.summary}` : ""}
      </p>
    );
  const hasSavedHistory = Boolean(lastRunAt || lastResult);
  const label =
    !preview || preview.kind === "loading"
      ? "Last run: loading status…"
      : preview.kind === "deferred"
        ? `Last run: not checked yet. Refresh after ${formatDisplayDateTime(preview.retryAt, timeFormat)}.`
        : preview.kind === "unavailable"
          ? "Last run status unavailable. Refresh to try again."
          : hasSavedHistory
            ? "Last run: status unavailable in run history."
            : "Last run: no run recorded";
  return (
    <div>
      <p className="spec400-supporting">{label}</p>
      {hasSavedHistory && (
        <p className="mt-1 text-xs text-muted-foreground">
          Saved task history{lastRunAt ? ` · ${formatDisplayDateTime(lastRunAt, timeFormat)}` : ""}
          {lastResult ? ` · ${lastResult}` : ""}
        </p>
      )}
    </div>
  );
}
