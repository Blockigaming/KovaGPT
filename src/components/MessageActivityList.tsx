import { CalendarDays, CheckCircle2, FileText, Globe, Loader2, Mail } from "lucide-react";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
import type { Activity } from "@/lib/chat-store";

export function MessageActivityList({ activities }: { activities?: Activity[] }) {
  const rows = activities?.filter((activity) => activity.tool !== "scheduled_task") ?? [];
  if (!rows.length) return null;\n  const completed = rows.filter((activity) => activity.status === "done").length;\n  const running = rows.find((activity) => activity.status === "running");
  return (
    <ol
      className="kova-activity-list"
      aria-label="Activity"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {rows.map((activity, index) => {
        const tool = activity.tool.toLowerCase();
        const Icon =
          tool.includes("gmail") || tool.includes("email")
            ? Mail
            : tool.includes("calendar")
              ? CalendarDays
              : tool.includes("drive") || tool.includes("file") || tool.includes("document")
                ? FileText
                : Globe;
        const brand = Object.keys(PLUGIN_BRAND_ASSET_URLS).find(
          (id) => tool.includes(id.replaceAll("-", "_")) || tool.includes(id),
        );
        const status =
          activity.status === "running"
            ? "In progress"
            : activity.status === "failed"
              ? "Failed"
              : activity.status === "canceled"
                ? "Canceled"
                : "Completed";
        return (
          <li
            key={activity.activityId ? `operation-${activity.activityId}` : index}
            className="kova-activity-row"
            data-status={activity.status}
          >
            {brand ? (
              <img src={PLUGIN_BRAND_ASSET_URLS[brand]} className="kova-activity-icon" alt="" />
            ) : (
              <Icon className="kova-activity-icon" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">
              <span className="sr-only">{status}: </span>
              <span>{activity.label}</span>\n              {activity.browser?.hostname && (\n                <span className="ml-2 inline-flex rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground" title="Observed browser website">\n                  {activity.browser.hostname}\n                </span>\n              )}
            </span>
            {(activity.status === "failed" || activity.status === "canceled") && (
              <span className="shrink-0 text-xs" aria-hidden="true">
                {status}
              </span>
            )}
            {activity.status === "done" && (\n              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Completed" />\n            )}\n            {activity.status === "running" && (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
