import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

async function ensurePlusOrAbove(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"]);
  if (error) { console.error("[serverfn]", error.message); throw new Error("Request failed. Please try again."); }
  const ok = (data ?? []).some(
    (r: any) =>
      ["active", "trialing"].includes(r.status) &&
      (!r.current_period_end || new Date(r.current_period_end) > new Date()),
  );
  if (!ok) {
    throw new Error("Scheduled tasks are available on Plus, Pro, and higher plans.");
  }
}

export const isScheduledTasksEligible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ eligible: boolean }> => {
    const { data, error } = await context.supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", context.userId)
      .in("status", ["active", "trialing"]);
    if (error) return { eligible: false };
    const ok = (data ?? []).some(
      (r: any) =>
        ["active", "trialing"].includes(r.status) &&
        (!r.current_period_end || new Date(r.current_period_end) > new Date()),
    );
    return { eligible: ok };
  });

export const listScheduledTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledTask[]> => {
    const { data, error } = await context.supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("run_at", { ascending: true });
    if (error) { console.error("[serverfn]", error.message); throw new Error("Request failed. Please try again."); }
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
  .inputValidator((i: unknown) => CreateSchema.parse(i))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    await ensurePlusOrAbove(context.supabase, context.userId);
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
    if (error || !row) { console.error("[serverfn]", error?.message); throw new Error("Failed to create task"); }
    return row as ScheduledTask;
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  run_at: z.string().datetime().optional(),
  repeat: RepeatEnum.optional(),
  status: z.enum(["scheduled", "paused"]).optional(),
});

export const updateScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateSchema.parse(i))
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    await ensurePlusOrAbove(context.supabase, context.userId);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.prompt !== undefined) patch.prompt = data.prompt;
    if (data.run_at !== undefined) {
      patch.run_at = data.run_at;
      patch.next_run_at = data.run_at;
    }
    if (data.repeat !== undefined) patch.repeat = data.repeat;
    if (data.status !== undefined) patch.status = data.status;
    const { data: row, error } = await (context.supabase as any)
      .from("scheduled_tasks")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error || !row) { console.error("[serverfn]", error?.message); throw new Error("Failed to update task"); }
    return row as ScheduledTask;
  });

const DeleteSchema = z.object({ id: z.string().uuid() });

export const deleteScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("scheduled_tasks")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) { console.error("[serverfn]", error.message); throw new Error("Request failed. Please try again."); }
    return { ok: true };
  });
