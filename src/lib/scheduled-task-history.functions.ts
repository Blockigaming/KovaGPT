import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scheduledExecutionRuntimeAvailable,
  type ScheduledTask,
} from "@/lib/scheduled-tasks.functions";

type LooseClient = {
  // Forward scheduler migrations intentionally precede generated production
  // database types. Keep this compatibility boundary server-only and owner-RLS
  // scoped until the approved schema is applied and types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc: <T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: T | null; error: { message: string } | null }>;
};

type OccurrenceRow = {
  id: string;
  task_id: string;
  scheduled_for: string;
  recurrence_anchor: string;
  manual_retry_of: string | null;
  scheduled_local: string | null;
  time_zone: string;
  status: string;
  result_summary: string | null;
  failure_type: string | null;
  safe_error: string | null;
  retry_after: string | null;
  completed_at: string | null;
  schedule_resolution: string | null;
  missed_count: number;
};

type AttemptRow = {
  id: string;
  occurrence_id: string;
  attempt_number: number;
  status: string;
  failure_type: string | null;
  safe_error: string | null;
  retry_after: string | null;
  started_at: string;
  completed_at: string | null;
};

type DeliveryRow = {
  id: string;
  occurrence_id: string;
  channel: string;
  event_type: string;
  status: string;
  attempt_count: number;
  delivered_at: string | null;
  last_safe_error: string | null;
};

export type ScheduledTaskHistoryAttempt = {
  id: string;
  number: number;
  status: string;
  failureType: string | null;
  safeError: string | null;
  retryAt: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type ScheduledTaskHistoryDelivery = {
  id: string;
  channel: string;
  eventType: string;
  status: string;
  attemptCount: number;
  deliveredAt: string | null;
  safeError: string | null;
};

export type ScheduledTaskHistoryOccurrence = {
  id: string;
  scheduledFor: string;
  recurrenceAnchor: string;
  manualRetryOf: string | null;
  scheduledLocal: string | null;
  timeZone: string;
  status: string;
  resultSummary: string | null;
  failureType: string | null;
  safeError: string | null;
  retryAt: string | null;
  completedAt: string | null;
  scheduleResolution: string | null;
  missedCount: number;
  attempts: ScheduledTaskHistoryAttempt[];
  deliveries: ScheduledTaskHistoryDelivery[];
};

const TaskIdSchema = z.object({ taskId: z.string().uuid() });

export const listScheduledTaskHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TaskIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScheduledTaskHistoryOccurrence[]> => {
    const client = context.supabase as unknown as LooseClient;
    const occurrences = await client
      .from("scheduled_task_occurrences")
      .select(
        "id,task_id,scheduled_for,recurrence_anchor,manual_retry_of,scheduled_local,time_zone,status,result_summary,failure_type,safe_error,retry_after,completed_at,schedule_resolution,missed_count",
      )
      .eq("user_id", context.userId)
      .eq("task_id", data.taskId)
      .order("scheduled_for", { ascending: false })
      .limit(50);

    if (occurrences.error) {
      throw new Error("Scheduled task history could not be loaded.");
    }

    const occurrenceRows = (occurrences.data ?? []) as OccurrenceRow[];
    if (occurrenceRows.length === 0) return [];
    const occurrenceIds = occurrenceRows.map((row) => row.id);

    const [attempts, deliveries] = await Promise.all([
      client
        .from("scheduled_task_attempts")
        .select(
          "id,occurrence_id,attempt_number,status,failure_type,safe_error,retry_after,started_at,completed_at",
        )
        .eq("user_id", context.userId)
        .in("occurrence_id", occurrenceIds)
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("scheduled_task_delivery_outbox")
        .select(
          "id,occurrence_id,channel,event_type,status,attempt_count,delivered_at,last_safe_error",
        )
        .eq("user_id", context.userId)
        .in("occurrence_id", occurrenceIds)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (attempts.error || deliveries.error) {
      throw new Error("Scheduled task history could not be loaded.");
    }

    const attemptsByOccurrence = new Map<string, ScheduledTaskHistoryAttempt[]>();
    for (const row of (attempts.data ?? []) as AttemptRow[]) {
      const items = attemptsByOccurrence.get(row.occurrence_id) ?? [];
      items.push({
        id: row.id,
        number: row.attempt_number,
        status: row.status,
        failureType: row.failure_type,
        safeError: row.safe_error,
        retryAt: row.retry_after,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      });
      attemptsByOccurrence.set(row.occurrence_id, items);
    }

    const deliveriesByOccurrence = new Map<string, ScheduledTaskHistoryDelivery[]>();
    for (const row of (deliveries.data ?? []) as DeliveryRow[]) {
      const items = deliveriesByOccurrence.get(row.occurrence_id) ?? [];
      items.push({
        id: row.id,
        channel: row.channel,
        eventType: row.event_type,
        status: row.status,
        attemptCount: row.attempt_count,
        deliveredAt: row.delivered_at,
        safeError: row.last_safe_error,
      });
      deliveriesByOccurrence.set(row.occurrence_id, items);
    }

    return occurrenceRows.map((row) => ({
      id: row.id,
      scheduledFor: row.scheduled_for,
      recurrenceAnchor: row.recurrence_anchor,
      manualRetryOf: row.manual_retry_of,
      scheduledLocal: row.scheduled_local,
      timeZone: row.time_zone,
      status: row.status,
      resultSummary: row.result_summary,
      failureType: row.failure_type,
      safeError: row.safe_error,
      retryAt: row.retry_after,
      completedAt: row.completed_at,
      scheduleResolution: row.schedule_resolution,
      missedCount: row.missed_count,
      attempts: attemptsByOccurrence.get(row.id) ?? [],
      deliveries: deliveriesByOccurrence.get(row.id) ?? [],
    }));
  });

export const retryScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TaskIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    if (!scheduledExecutionRuntimeAvailable()) {
      throw new Error("Scheduled execution is not available, so this task cannot be retried.");
    }

    const result = await (context.supabase as unknown as LooseClient).rpc<ScheduledTask>(
      "owner_retry_scheduled_task_v2",
      { p_task_id: data.taskId },
    );
    if (result.error || !result.data || typeof result.data.id !== "string") {
      throw new Error("Failed to retry scheduled task.");
    }
    return result.data;
  });
