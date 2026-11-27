import { useId, useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { summarizeCreatedFiles, type ResponseFile } from "@/lib/response-files.mjs";
import { MessageActivityList } from "./MessageActivityList";
import "./prompt-activity.css";
import "./response-files.css";

function activityPhrase(activities: Activity[]) {
  const tools = activities.map((activity) => activity.tool.toLowerCase());
  const phrases: string[] = [];
  if (tools.some((tool) => tool.includes("search") || tool.includes("web")))
    phrases.push("searched the web");
  if (tools.some((tool) => tool.includes("browser"))) phrases.push("used the browser");
  const other = tools.filter(
    (tool) => !tool.includes("search") && !tool.includes("web") && !tool.includes("browser"),
  ).length;
  if (other) phrases.push(`ran ${other} ${other === 1 ? "step" : "steps"}`);
  return phrases;
}

/**
 * One expandable line summarising a reply's work ("Searched the web, created a file ›").
 * Initially expanded, it shows every step and every file the reply made.
 */
export function ResponseActivitySummary({
  activities,
  files,
}: {
  activities?: Activity[];
  files: ResponseFile[];
}) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const rows = activities?.filter((activity) => activity.tool !== "scheduled_task") ?? [];
  const created = summarizeCreatedFiles(files);
  if (!created) return <MessageActivityList activities={activities} />;
  const label = [...activityPhrase(rows), created.toLowerCase()].join(", ");
  const names = [...new Set(files.filter((file) => file.complete).map((file) => file.name))];
  return (
    <div className="kova-activity-summary-group">
      <button
        type="button"
        className="kova-activity-summary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
        <ChevronRight aria-hidden="true" />
      </button>
      <div id={panelId} className="kova-activity-summary-panel" hidden={!open}>
        {open && (
          <>
            <MessageActivityList activities={activities} />
            <ol className="kova-activity-list" aria-label="Files created">
              {names.map((name) => (
                <li key={name} className="kova-activity-row" data-status="completed">
                  <span className="kova-activity-logo" aria-hidden="true">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="sr-only">Completed: </span>
                    Created {name}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
