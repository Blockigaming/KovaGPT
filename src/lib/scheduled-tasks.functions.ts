import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type SubscriptionQueryLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        in: (
          column: string,
          values: unknown[],
        ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};

type RpcClientLike = {
  rpc: <T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: T | null; error: { message: string } | null }>;
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

async function hasPaidScheduledTaskPlan(supabase: unknown, userId: string): Promise<boolean> {
  const { data, error } = await (supabase as SubscriptionQueryLike)
    .from("subscriptions")
    .select("status, current_period_end, price_id")
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "canceled"]);

  if (error) {
    console.error("[serverfn]", error.message);
    throw new Error("Plan status could not be checked. Please try again.");
  }

  return (
    (data ?? []) as {
      status?: string;
      current_period_end?: string | null;
      price_id?: string | null;
    }[]
  ).some((row) => {
    const periodActive =
      !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now();
    const price = (row.price_id ?? "").toLowerCase();
    return (
      ["active", "trialing", "canceled"].includes(row.status ?? "") &&
      periodActive &&
      (price.includes("plus") || price.includes("pro"))
    );
  });
}

function rpcClient(supabase: unknown): RpcClientLike {
  return supabase as RpcClientLike;
}

function requireTaskRow(value: unknown, fallback: string): ScheduledTask {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    throw new Error(fallback);
  }
  return value as ScheduledTask;
}

// Keep fail-closed until the v2 schema, dedicated worker, Azure scheduled Job,
// fresh heartbeat and production canary are all proven together.
export const scheduledExecutionAvailable = false;

export const isScheduledTasksEligible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ eligible: boolean; executionAvailable: boolean }> => ({
    eligible: await hasPaidScheduledTaskPlan(context.supabase, context.userId),
    executionAvailable: scheduledExecutionAvailable,
  }));

export const listScheduledTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledTask[]> => {
    const { data, error } = await context.supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .is("deleted_at", null)
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
  time_zone: z.string().trim().min(1).max(100).default("UTC"),
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

    const result = await rpcClient(context.supabase).rpc<ScheduledTask>(
      "owner_create_scheduled_task_v2",
      {
        p_title: data.title,
        p_prompt: data.prompt,
        p_run_at: data.run_at,
        p_repeat: data.repeat,
        p_time_zone: data.time_zone,
        p_schedule_rule: null,
      },
    );

    if (result.error) {
      console.error("[serverfn]", result.error.message);
      throw new Error("Failed to create task");
    }
    return requireTaskRow(result.data, "Failed to create task");
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  run_at: z.string().datetime().optional(),
  repeat: RepeatEnum.optional(),
  time_zone: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["scheduled", "paused"]).optional(),
});

export const updateScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => UpdateSchema.parse(i))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    if (data.status === "scheduled" && !scheduledExecutionAvailable) {
      throw new Error("Scheduled execution is not available, so this task cannot be resumed.");
    }

    const rpc = rpcClient(context.supabase);
    let row: ScheduledTask | null = null;
    const hasContentPatch =
      data.title !== undefined ||
      data.prompt !== undefined ||
      data.run_at !== undefined ||
      data.repeat !== undefined ||
      data.time_zone !== undefined;

    if (hasContentPatch) {
      const update = await rpc.rpc<ScheduledTask>("owner_update_scheduled_task_v2", {
        p_task_id: data.id,
        p_title: data.title ?? null,
        p_prompt: data.prompt ?? null,
        p_run_at: data.run_at ?? null,
        p_repeat: data.repeat ?? null,
        p_time_zone: data.time_zone ?? null,
        p_schedule_rule: null,
        p_replace_schedule_rule: false,
      });
      if (update.error) {
        console.error("[serverfn]", update.error.message);
        throw new Error("Failed to update task");
      }
      row = requireTaskRow(update.data, "Failed to update task");
    }

    if (data.status !== undefined) {
      const state = await rpc.rpc<ScheduledTask>("owner_set_scheduled_task_state_v2", {
        p_task_id: data.id,
        p_action: data.status === "paused" ? "pause" : "resume",
      });
      if (state.error) {
        console.error("[serverfn]", state.error.message);
        throw new Error("Failed to update task");
      }
      row = requireTaskRow(state.data, "Failed to update task");
    }

    if (!row) {
      throw new Error("No scheduled-task changes were requested.");
    }
    return row;
  });

const DeleteSchema = z.object({ id: z.string().uuid() });

export const deleteScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => DeleteSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const result = await rpcClient(context.supabase).rpc<ScheduledTask>(
      "owner_set_scheduled_task_state_v2",
      {
        p_task_id: data.id,
        p_action: "delete",
      },
    );

    if (result.error || !result.data) {
      console.error("[serverfn]", result.error?.message);
      throw new Error("Request failed. Please try again.");
    }
    return { ok: true };
  });
