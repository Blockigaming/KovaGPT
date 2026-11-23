import { ChevronRight, Code2, Globe, Search, Zap } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { groupFailed, summarizeActivityGroup } from "@/lib/activity-groups.mjs";
import { orderRows, renderActivityRow } from "./MessageActivityList";
import { ResponseSourceIcon } from "./ResponseSourceIcon";

/**
 * One line between paragraphs that sums up the steps taken there
 * ("Used GitHub and Supabase, ran 7 commands, and searched the web").
 * It expands into the individual steps along a thin guide line; while a step is
 * running the line shows that step and shimmers.
 */
export function ActivityGroup({
  activities,
  defaultOpen = false,
}: {
  activities: Activity[];
  defaultOpen?: boolean;
}) {
  const rows = activities.filter((activity) => activity.tool !== "scheduled_task");
  if (!rows.length) return null;
  const running = rows.some((row) => row.status === "running");
  const summary = summarizeActivityGroup(rows);
  const failed = groupFailed(rows);
  const lead = rows.find((row) => row.status === "running") ?? rows[0];
  return (
    <details
      className="kova-step-group"
      data-running={running || undefined}
      open={defaultOpen || undefined}
    >
      <summary>
        <ResponseSourceIcon
          className="kova-step-group-icon"
          hostname={lead.browser?.hostname}
          tool={lead.tool.toLowerCase()}
          fallback={groupGlyph(rows)}
        />
        <span className="kova-step-group-text">{summary}</span>
        {failed && <span className="kova-step-group-flag">Needs attention</span>}
        <ChevronRight className="kova-step-group-chevron" aria-hidden="true" />
      </summary>
      <ol className="kova-step-group-list" aria-label="Steps">
        {orderRows(rows).map(({ activity, nested, key }) =>
          renderActivityRow(
            activity,
            nested,
            activity.activityId ? `step-${activity.activityId}` : key,
          ),
        )}
      </ol>
    </details>
  );
}

/** The group's icon: one kind of step shows its own symbol; a mix shows a bolt. */
function groupGlyph(rows: Activity[]) {
  const kinds = new Set(
    rows.map(({ tool }) =>
      /code|python|command|shell|exec|run|terminal/u.test(tool)
        ? "command"
        : /read|glob|grep|file|library/u.test(tool)
          ? "files"
          : /web|browser|search|fetch|url/u.test(tool)
            ? "web"
            : "other",
    ),
  );
  if (kinds.size > 1) return Zap;
  const [kind] = kinds;
  return kind === "command" ? Code2 : kind === "files" ? Search : kind === "web" ? Globe : Zap;
}
