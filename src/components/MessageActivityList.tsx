import { CalendarDays, FileText, Globe, Loader2, Mail } from "lucide-react";
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
        const status =
          activity.status === "running"
            ? "In progress"
            : activity.status === "failed"
              ? "Failed"
              : activity.status === "canceled"
                ? "Canceled"
                : "Completed";
        return (
          <li key={index} className="kova-activity-row" data-status={activity.status}>
            <Icon className="kova-activity-icon" aria-hidden="true" />
            <span className="min-w-0 break-words">
              <span className="sr-only">{status}: </span>
              {activity.label}
            </span>
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
