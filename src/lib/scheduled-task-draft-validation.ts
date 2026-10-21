import { parseTaskPayload } from "@/lib/scheduled-task-policy.mjs";

export type ScheduledTaskValidationField =
  "title" | "prompt" | "date" | "time" | "timezone" | "consent";
export type ScheduledTaskValidationIssue = {
  field: ScheduledTaskValidationField;
  label: string;
  message: string;
};

/** Local feedback only: the scheduler still owns future dates, DST, and event admission. */
export function validateScheduledTaskDraft(draft: {
  title: string;
  prompt: string;
  localTime: string;
  timezone: string;
  mode: "time" | "event";
  consent: boolean;
}): ScheduledTaskValidationIssue[] {
  const issues: ScheduledTaskValidationIssue[] = [];
  const check = (
    field: ScheduledTaskValidationField,
    label: string,
    value: Record<string, string>,
    message: string,
  ) => {
    try {
      // Reuse the service's client-safe partial field checks; do not validate or alter its payload.
      parseTaskPayload(value, true);
    } catch {
      issues.push({ field, label, message });
    }
  };
  check("title", "Title", { title: draft.title }, "Enter a title using 200 characters or fewer.");
  check(
    "prompt",
    "Prompt",
    { prompt: draft.prompt },
    "Enter a prompt using 4,000 characters or fewer.",
  );
  if (draft.mode === "time") {
    const separator = draft.localTime.indexOf("T");
    const date = separator === -1 ? draft.localTime : draft.localTime.slice(0, separator);
    const time = separator === -1 ? "" : draft.localTime.slice(separator + 1);
    // Fixed counterparts isolate each field's shape/calendar validity, never a real run instant.
    check("date", "Date", { localTime: `${date}T00:00` }, "Enter a valid date.");
    check("time", "Time", { localTime: `2000-01-01T${time}` }, "Enter a valid time.");
  }
  check(
    "timezone",
    "Timezone",
    { timezone: draft.timezone },
    "Choose a recognized timezone, such as America/New_York or UTC.",
  );
  if (!draft.consent)
    issues.push({
      field: "consent",
      label: "Confirmation",
      message: "Select the confirmation checkbox before saving.",
    });
  return issues;
}
