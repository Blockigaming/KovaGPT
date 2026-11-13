import { CalendarDays, FileText, Globe, Loader2, Mail } from "lucide-react";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
import type { Activity } from "@/lib/chat-store";

export function MessageActivityList({ activities }: { activities?: Activity[] }) {
  const rows = activities?.filter((activity) => activity.tool !== "scheduled_task") ?? [];
  if (!rows.length) return null;
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
        const hostname = activity.browser?.hostname?.toLowerCase();
        const domain = hostname?.replace(/\.$/, "");
        const siteBrand = ["github", "notion", "linear"].find(
          (id) => domain === `${id}.com` || domain?.endsWith(`.${id}.com`),
        );
        const brand = hostname
          ? siteBrand
          : Object.keys(PLUGIN_BRAND_ASSET_URLS).find(
              (id) => tool.includes(id.replaceAll("-", "_")) || tool.includes(id),
            );
        const logo = brand ? PLUGIN_BRAND_ASSET_URLS[brand] : undefined;
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
            {logo ? (
              <img src={logo} className="kova-activity-icon" alt="" />
            ) : (
              <Icon className="kova-activity-icon" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">
              <span className="sr-only">{status}: </span>
              <span>{activity.label}</span>
              {activity.browser?.hostname && (
                <span
                  className="ml-2 text-xs text-muted-foreground"
                  title="Observed browser website"
                >
                  {activity.browser.hostname}
                </span>
              )}
            </span>
            {(activity.status === "failed" || activity.status === "canceled") && (
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
      })}
    </ol>
  );
}
