import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Code2,
  FileText,
  Globe,
  Loader2,
  Mail,
  Pause,
  Search,
  XCircle,
  Zap,
} from "lucide-react";
import { ResponseSourceIcon } from "./ResponseSourceIcon";
import type { Activity } from "@/lib/chat-store";

const STATUS_TEXT: Record<Activity["status"], string> = {
  running: "In progress",
  queued: "Queued",
  paused: "Paused",
  failed: "Failed",
  canceled: "Canceled",
  skipped: "Skipped",
  partial: "Partly completed",
  done: "Completed",
};

/** Settled histories longer than this support collapsing into one summary line. */
const COLLAPSE_AFTER = 5;

export function formatActivityDuration(ms: number) {
  if (ms < 1_000) return "under 1s";
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

// A plain render function (not a component) so the list stays a hook-free tree.
export function renderActivityRow(activity: Activity, nested: boolean, key: string | number) {
  const tool = activity.tool.toLowerCase();
  const Icon =
    tool.includes("gmail") || tool.includes("email")
      ? Mail
      : tool.includes("calendar")
        ? CalendarDays
        : tool.includes("drive") || tool.includes("file") || tool.includes("document")
          ? FileText
          : /code|python|command|shell|exec|run|terminal/u.test(tool)
            ? Code2
            : /read|glob|grep|library|search_files/u.test(tool)
              ? Search
              : /web|browser|search|fetch|url/u.test(tool)
                ? Globe
                : Zap;
  const status = STATUS_TEXT[activity.status] ?? "Completed";
  const progress =
    typeof activity.count === "number" && typeof activity.total === "number" && activity.total > 0
      ? Math.min(1, activity.count / activity.total)
      : null;
  const meta = [
    progress === null && typeof activity.count === "number"
      ? activity.count.toLocaleString()
      : null,
    typeof activity.durationMs === "number" && activity.status !== "running"
      ? formatActivityDuration(activity.durationMs)
      : null,
  ].filter(Boolean);
  return (
    <li
      key={key}
      className="kova-activity-row"
      data-status={activity.status}
      data-nested={nested || undefined}
    >
      <ResponseSourceIcon
        className="kova-activity-logo"
        hostname={activity.browser?.hostname}
        tool={tool}
        fallback={Icon}
      />
      <span className="kova-activity-text min-w-0 break-words">
        <span className="sr-only">{status}: </span>
        <span>{activity.label}</span>
        {activity.browser?.hostname && (
          <span className="ml-2 text-xs text-muted-foreground" title="Observed browser website">
            {activity.browser.hostname}
          </span>
        )}
        {activity.detail && <span className="kova-activity-detail">{activity.detail}</span>}
        {progress !== null && (
          <span className="kova-activity-progress">
            <progress
              max={activity.total}
              value={activity.count}
              aria-label={`${activity.count} of ${activity.total}`}
            />
            <span aria-hidden="true">
              {activity.count!.toLocaleString()} of {activity.total!.toLocaleString()}
            </span>
          </span>
        )}
      </span>
      {meta.length > 0 && (
        <span className="kova-activity-meta" title={status}>
          {meta.join(" · ")}
        </span>
      )}
      {activity.status === "failed" && (
        <XCircle className="kova-activity-state" data-tone="error" aria-hidden="true" />
      )}
      {activity.status === "partial" && (
        <AlertTriangle className="kova-activity-state" data-tone="warning" aria-hidden="true" />
      )}
      {activity.status === "queued" && <Clock className="kova-activity-state" aria-hidden="true" />}
      {activity.status === "paused" && <Pause className="kova-activity-state" aria-hidden="true" />}
      {(activity.status === "failed" ||
        activity.status === "canceled" ||
        activity.status === "skipped") && (
        <span className="shrink-0 text-xs" aria-hidden="true">
          {status}
        </span>
      )}
      {activity.status === "running" && (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </li>
  );
}

/** Children follow their parent operation; orphans stay in arrival order. */
export function orderRows(rows: Activity[]) {
  const ids = new Set(rows.map((row) => row.activityId).filter(Boolean));
  const ordered: { activity: Activity; nested: boolean; key: string | number }[] = [];
  rows.forEach((activity, index) => {
    if (activity.parentId && ids.has(activity.parentId)) return;
    ordered.push({ activity, nested: false, key: activity.activityId ?? index });
    if (!activity.activityId) return;
    rows.forEach((child, childIndex) => {
      if (child.parentId === activity.activityId)
        ordered.push({
          activity: child,
          nested: true,
          key: child.activityId ?? `child-${childIndex}`,
        });
    });
  });
  return ordered;
}

export function MessageActivityList({ activities }: { activities?: Activity[] }) {
  const rows = activities?.filter((activity) => activity.tool !== "scheduled_task") ?? [];
  if (!rows.length) return null;
  const ordered = orderRows(rows);
  const live = rows.some((row) => ["running", "queued", "paused"].includes(row.status));
  const list = (
    <ol
      className="kova-activity-list"
      aria-label="Activity"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {ordered.map(({ activity, nested, key }) =>
        renderActivityRow(
          activity,
          nested,
          activity.activityId ? `operation-${activity.activityId}` : key,
        ),
      )}
    </ol>
  );
  if (live || rows.length <= COLLAPSE_AFTER) return list;
  // A long finished history can collapse to one line that still names any problems.
  const failed = rows.filter((row) => row.status === "failed" || row.status === "partial").length;
  const total = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
  return (
    <details className="kova-activity-group" open>
      <summary className="kova-activity-group-summary">
        {rows.length} steps
        {total > 0 ? ` · ${formatActivityDuration(total)}` : ""}
        {failed ? ` · ${failed} need${failed === 1 ? "s" : ""} attention` : ""}
      </summary>
      {list}
    </details>
  );
}
