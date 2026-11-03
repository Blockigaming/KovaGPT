import { useState } from "react";
import type { ResponseSource } from "@/lib/response-sources";
import { CalendarDays, FileText, Globe, Loader2, Mail } from "lucide-react";
import type { Activity } from "@/lib/chat-store";

function WebsiteIcon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className="kova-activity-icon" aria-hidden="true" />;
  return (
    <img
      className="kova-activity-icon"
      width={16}
      height={16}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      onError={() => setFailed(true)}
    />
  );
}

export function MessageActivityList({
  activities,
  sources,
}: {
  activities?: Activity[];
  sources?: ResponseSource[];
}) {
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
          <li
            key={activity.activityId ? `operation-${activity.activityId}` : index}
            className="kova-activity-row"
            data-status={activity.status}
          >
            {tool === "search_web" && sources?.[0]?.domain ? (
              <WebsiteIcon domain={sources[0].domain} />
            ) : (
              <Icon className="kova-activity-icon" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">
              <span className="sr-only">{status}: </span>
              <span>{activity.label}</span>
              {tool === "search_web" && sources?.length ? (
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {Array.from(new Map(sources.map((source) => [source.domain, source])).values())
                    .slice(0, 6)
                    .map((source) => (
                      <a
                        key={source.domain}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                      >
                        <WebsiteIcon domain={source.domain} />
                        {source.domain}
                      </a>
                    ))}
                </span>
              ) : null}
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
