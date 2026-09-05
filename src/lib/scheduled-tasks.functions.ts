import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type SupabaseQueryLike = {
  from: (table: string) => SupabaseQueryLike;
  select: (columns?: string) => SupabaseQueryLike;
  insert: (values: unknown) => SupabaseQueryLike;
  update: (values: unknown) => SupabaseQueryLike;
  eq: (column: string, value: unknown) => SupabaseQueryLike;
  in: (column: string, values: unknown[]) => SupabaseQueryLike;
  order: (column: string, options?: unknown) => SupabaseQueryLike;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  run_at: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  status: "scheduled" | "running" | "paused" | "completed" | "failed";
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: string | null;
  created_at: string;
  updated_at: string;
};

const RepeatEnum = z.enum(["none", "daily", "weekly", "monthly"]);

async function ensurePlusOrAbove(supabase: unknown): Promise<"plus" | "pro"> {
  const client = supabase as {
    rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("current_effective_plan_tier");
  if (error) {
    console.error("[serverfn]", error.message);
    throw new Error("Request failed. Please try again.");
  }
  if (data !== "plus" && data !== "pro") {
    throw new Error("Scheduled tasks are available on Plus, Pro, and higher plans.");
  }
  return data;
}

const MAX_TASKS: Record<"plus" | "pro", number> = { plus: 5, pro: 20 };

// This repository currently has no deployed process that claims due rows and
// executes them. Keep creation/resume fail-closed until that real worker is
// added rather than storing tasks that can never run.
export const scheduledExecutionAvailable = false;

export const isScheduledTasksEligible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ eligible: boolean; executionAvailable: boolean }> => {
    const { data, error } = await context.supabase.rpc("current_effective_plan_tier");
    if (error) throw new Error("Plan status could not be checked. Please try again.");
    return {
      eligible: data === "plus" || data === "pro",
      executionAvailable: scheduledExecutionAvailable,
    };
  });

export const listScheduledTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledTask[]> => {
    const { data, error } = await context.supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("run_at", { ascending: true });
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("Request failed. Please try again.");
    }
    return (data ?? []) as ScheduledTask[];
  });

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(4000),
  run_at: z.string().datetime(),
  repeat: RepeatEnum.default("none"),
});

export const createScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => CreateSchema.parse(i))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    if (!scheduledExecutionAvailable) {
      throw new Error(
        "Scheduled execution is not available in this deployment. No task was created.",
      );
    }
    const tier = await ensurePlusOrAbove(context.supabase);
    const { count, error: countError } = await context.supabase
      .from("scheduled_tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .in("status", ["scheduled", "running", "paused"]);
    if (countError) {
      console.error("[serverfn]", countError.message);
      throw new Error("Request failed. Please try again.");
    }
    const limit = MAX_TASKS[tier];
    if ((count ?? 0) >= limit) {
      throw new Error(
        tier === "pro"
          ? `Pro plan allows up to ${limit} ongoing scheduled tasks. Delete one to create another.`
          : `Plus plan allows up to ${limit} ongoing scheduled tasks. Upgrade to Pro for up to ${MAX_TASKS.pro}.`,
      );
    }
    const { data: row, error } = await context.supabase
      .from("scheduled_tasks")
      .insert({
        user_id: context.userId,
        title: data.title,
        prompt: data.prompt,
        run_at: data.run_at,
        next_run_at: data.run_at,
        repeat: data.repeat,
        status: "scheduled",
      })
      .select("*")
      .single();
    if (error || !row) {
      console.error("[serverfn]", error?.message);
      throw new Error("Failed to create task");
    }
    return row as ScheduledTask;
  });

const UpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    prompt: z.string().trim().min(1).max(4000).optional(),
    run_at: z.string().datetime().optional(),
    repeat: RepeatEnum.optional(),
    status: z.enum(["scheduled", "paused"]).optional(),
    retry: z.boolean().optional(),
  })
  .refine((input) => !input.retry || input.status === "scheduled", {
    message: "Retry must schedule a failed task.",
  });

export const updateScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => UpdateSchema.parse(i))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    await ensurePlusOrAbove(context.supabase);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.prompt !== undefined) patch.prompt = data.prompt;
    if (data.run_at !== undefined) {
      patch.run_at = data.run_at;
      patch.next_run_at = data.run_at;
    }
    if (data.repeat !== undefined) patch.repeat = data.repeat;
    if (data.status !== undefined) patch.status = data.status;
    if (data.status === "scheduled" && !scheduledExecutionAvailable) {
      throw new Error("Scheduled execution is not available, so this task cannot be resumed.");
    }
    let updateQuery = (context.supabase as unknown as SupabaseQueryLike)
      .from("scheduled_tasks")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (data.retry) {
      // Retry is a separate intent. Only a still-failed task can be claimed,
      // so two retries cannot reset a newly running or completed execution.
      updateQuery = updateQuery.eq("status", "failed");
    } else if (data.status !== undefined) {
      // Keep the state check in the same statement as the write. A worker may
      // complete a task between browser intent and this request reaching the
      // database, and a separate read would allow that terminal state to be
      // overwritten by a late pause/resume.
      updateQuery = updateQuery.in("status", ["scheduled", "running", "paused"]);
    }
    const { data: row, error } = await updateQuery.select("*").maybeSingle();
    if (error || !row) {
      console.error("[serverfn]", error?.message);
      throw new Error(
        data.retry
          ? "Only a failed task can be retried. Refresh to see its current state."
          : data.status === undefined
            ? "The scheduled task could not be updated."
            : "Completed or failed tasks cannot be paused or resumed.",
      );
    }
    return row as ScheduledTask;
  });

const DeleteSchema = z.object({ id: z.string().uuid() });

export const deleteScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => DeleteSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("scheduled_tasks")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("Request failed. Please try again.");
    }
    return { ok: true };
  });
