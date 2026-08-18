export type ScheduledTaskType =
  | "one_time_reminder"
  | "recurring_reminder"
  | "recurring_summary"
  | "scheduled_search"
  | "conditional_monitor"
  | "connector_task";
export type ScheduledTaskStatus =
  "active" | "paused" | "running" | "completed" | "failed" | "disabled" | "awaiting_authorization";
export type TaskRunStatus =
  "scheduled" | "running" | "complete" | "failed" | "canceled" | "skipped_duplicate";
export type DeliveryChannel = "in_app" | "email";
export type TaskNotification = {
  delivery: DeliveryChannel[];
  destinationVerified: boolean;
  previewPolicy: "no_private_connector_content";
};
export type RecurrenceRule = {
  frequency: "once" | "hourly" | "daily" | "weekdays" | "weekly" | "monthly";
  interval?: number;
  weekdays?: number[];
  timeZone: string;
  startAt: string;
  endAt?: string;
  count?: number;
};
export type ScheduledTaskContract = {
  id: string;
  ownerId: string;
  type: ScheduledTaskType;
  title: string;
  instruction: string;
  recurrence: RecurrenceRule;
  status: ScheduledTaskStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  previousRunAt?: string | null;
  lastResult?: string | null;
  failureCount: number;
  delivery: DeliveryChannel[];
  chatId?: string;
  projectId?: string;
};
export type TaskRunRecord = {
  id: string;
  taskId: string;
  scheduledFor: string;
  startedAt?: string;
  completedAt?: string;
  status: TaskRunStatus;
  resultSummary?: string;
  deliveryStatus?: "pending" | "sent" | "failed" | "not_configured";
  failureType?: "temporary" | "permanent" | "authorization" | "timeout";
  retryEligible: boolean;
  safeLogs: string[];
  nextRunAt?: string | null;
};

export function validateRecurrence(rule: RecurrenceRule): RecurrenceRule {
  if (!/^UTC$|^[A-Za-z_]+\/[A-Za-z_/-]+$/.test(rule.timeZone))
    throw new Error("A valid time zone is required.");
  const start = new Date(rule.startAt);
  if (Number.isNaN(start.getTime())) throw new Error("A valid start date is required.");
  if (rule.frequency === "hourly" && (rule.interval ?? 1) < 1)
    throw new Error("Hourly schedules cannot run more than once per hour.");
  if (rule.weekdays?.some((day) => day < 0 || day > 6))
    throw new Error("Weekday values must be 0-6.");
  return { ...rule, interval: Math.max(1, rule.interval ?? 1), startAt: start.toISOString() };
}

export function scheduleSummary(rule: RecurrenceRule): string {
  const date = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: rule.timeZone,
  }).format(new Date(rule.startAt));
  if (rule.frequency === "once") return `Once on ${date} (${rule.timeZone})`;
  if (rule.frequency === "weekdays")
    return `Weekdays at ${date.split(", ").pop()} (${rule.timeZone})`;
  return `${rule.frequency} starting ${date} (${rule.timeZone})`;
}

export function selectDueTasks(tasks: ScheduledTaskContract[], now = new Date()) {
  return tasks.filter(
    (task) => task.status === "active" && task.nextRunAt && new Date(task.nextRunAt) <= now,
  );
}

export function createTaskRun(
  task: ScheduledTaskContract,
  scheduledFor: string,
  existingRunIds = new Set<string>(),
): TaskRunRecord {
  const id = `${task.id}:${scheduledFor}`;
  if (existingRunIds.has(id))
    return {
      id,
      taskId: task.id,
      scheduledFor,
      status: "skipped_duplicate",
      retryEligible: false,
      safeLogs: ["Duplicate run skipped."],
      deliveryStatus: "not_configured",
    };
  return {
    id,
    taskId: task.id,
    scheduledFor,
    startedAt: new Date().toISOString(),
    status: "running",
    retryEligible: true,
    safeLogs: ["Task execution started."],
    deliveryStatus: "pending",
  };
}

export function nextRunAfter(rule: RecurrenceRule, after: Date): string | null {
  if (rule.frequency === "once") return null;
  const next = new Date(after);
  const interval = rule.interval ?? 1;
  if (rule.frequency === "hourly") next.setUTCHours(next.getUTCHours() + interval);
  else if (rule.frequency === "daily" || rule.frequency === "weekdays")
    next.setUTCDate(next.getUTCDate() + interval);
  else if (rule.frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * interval);
  else next.setUTCMonth(next.getUTCMonth() + interval);
  if (rule.endAt && next > new Date(rule.endAt)) return null;
  return next.toISOString();
}
