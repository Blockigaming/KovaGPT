import { Check, Clock3, AlertCircle } from "lucide-react";
import { taskCreationNotice } from "@/lib/task-created-receipt.mjs";
export function TaskCreatedBubble({ activity }: { activity: unknown }) {
  const notice = taskCreationNotice(activity);
  if (!notice) return null;
  const content = (
    <>
      {notice.success ? (
        <Check aria-hidden="true" className="h-4 w-4 shrink-0 kova-task-success" />
      ) : notice.reason ? (
        <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : (
        <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />
      )}
      <span>{notice.text}</span>
    </>
  );
  return (
    <div className="kova-task-receipt" role="status">
      {notice.success && notice.taskId ? (
        <a
          href={`/scheduled-tasks?taskId=${encodeURIComponent(notice.taskId)}`}
          className="kova-button inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-border bg-accent px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Scheduled task created. Open schedule details"
        >
          {content}
        </a>
      ) : (
        <span className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-border bg-accent px-3 text-sm text-foreground">
          {content}
        </span>
      )}
      {notice.reason && <p className="mt-1 text-sm text-muted-foreground">{notice.reason}</p>}
    </div>
  );
}
