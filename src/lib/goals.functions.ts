import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type QueryLike = {
  select: (columns?: string) => QueryLike;
  insert: (value: unknown) => QueryLike;
  update: (value: unknown) => QueryLike;
  delete: () => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  order: (column: string, options?: unknown) => QueryLike;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then?: never;
};

const table = (supabase: unknown, name: string) =>
  (supabase as { from: (tableName: string) => QueryLike }).from(name);

export type GoalStatus = "active" | "paused" | "completed" | "archived";
export type GoalPriority = "low" | "medium" | "high";

export type GoalMilestone = {
  id: string;
  goal_id: string;
  title: string;
  completed: boolean;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Goal = {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  priority: GoalPriority;
  progress: number;
  target_date: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  milestones: GoalMilestone[];
};

const GoalInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  target_date: z.string().date().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const GoalPatch = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  target_date: z.string().date().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const MilestoneInput = z.object({
  goal_id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
});

const MilestonePatch = z.object({
  id: z.string().uuid(),
  goal_id: z.string().uuid(),
  title: z.string().trim().min(1).max(240).optional(),
  completed: z.boolean().optional(),
});

async function queryMany(query: QueryLike) {
  return (await (query as unknown as Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>)) as {
    data: unknown[] | null;
    error: { message: string } | null;
  };
}

export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Goal[]> => {
    const [goalsResult, milestonesResult] = await Promise.all([
      queryMany(
        table(context.supabase, "goals")
          .select(
            "id,title,description,status,priority,progress,target_date,project_id,created_at,updated_at",
          )
          .eq("owner_id", context.userId)
          .order("updated_at", { ascending: false }),
      ),
      queryMany(
        table(context.supabase, "goal_milestones")
          .select("id,goal_id,title,completed,position,completed_at,created_at,updated_at")
          .eq("owner_id", context.userId)
          .order("position", { ascending: true }),
      ),
    ]);

    if (goalsResult.error || milestonesResult.error) {
      throw new Error("Goals could not be loaded");
    }

    const milestones = (milestonesResult.data ?? []) as GoalMilestone[];

    return ((goalsResult.data ?? []) as Omit<Goal, "milestones">[]).map((goal) => ({
      ...goal,
      milestones: milestones.filter((item) => item.goal_id === goal.id),
    }));
  });

export const createGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GoalInput.parse(input))
  .handler(async ({ data, context }): Promise<Goal> => {
    const { data: row, error } = await table(context.supabase, "goals")
      .insert({
        owner_id: context.userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        target_date: data.target_date ?? null,
        project_id: data.project_id ?? null,
      })
      .select(
        "id,title,description,status,priority,progress,target_date,project_id,created_at,updated_at",
      )
      .single();

    if (error || !row) throw new Error("Goal could not be created");

    return { ...(row as Omit<Goal, "milestones">), milestones: [] };
  });

export const updateGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GoalPatch.parse(input))
  .handler(async ({ data, context }): Promise<Goal> => {
    const { id, ...patch } = data;

    const values: Record<string, unknown> = {
      ...patch,
      updated_at: new Date().toISOString(),
    };

    if (data.status === "completed" && data.progress === undefined) {
      values.progress = 100;
    }

    const { data: row, error } = await table(context.supabase, "goals")
      .update(values)
      .eq("id", id)
      .eq("owner_id", context.userId)
      .select(
        "id,title,description,status,priority,progress,target_date,project_id,created_at,updated_at",
      )
      .single();

    if (error || !row) throw new Error("Goal could not be updated");

    return { ...(row as Omit<Goal, "milestones">), milestones: [] };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await table(context.supabase, "goals")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .select("id")
      .single();

    if (error) throw new Error("Goal could not be deleted");
    return { ok: true as const };
  });

export const createGoalMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MilestoneInput.parse(input))
  .handler(async ({ data, context }): Promise<GoalMilestone> => {
    const goalCheck = await table(context.supabase, "goals")
      .select("id")
      .eq("id", data.goal_id)
      .eq("owner_id", context.userId)
      .single();

    if (goalCheck.error || !goalCheck.data) throw new Error("Goal not found");

    const { data: row, error } = await table(context.supabase, "goal_milestones")
      .insert({
        owner_id: context.userId,
        goal_id: data.goal_id,
        title: data.title,
      })
      .select("id,goal_id,title,completed,position,completed_at,created_at,updated_at")
      .single();

    if (error || !row) throw new Error("Milestone could not be created");
    return row as GoalMilestone;
  });

export const updateGoalMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MilestonePatch.parse(input))
  .handler(async ({ data, context }): Promise<GoalMilestone> => {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.title !== undefined) patch.title = data.title;

    if (data.completed !== undefined) {
      patch.completed = data.completed;
      patch.completed_at = data.completed ? new Date().toISOString() : null;
    }

    const { data: row, error } = await table(context.supabase, "goal_milestones")
      .update(patch)
      .eq("id", data.id)
      .eq("goal_id", data.goal_id)
      .eq("owner_id", context.userId)
      .select("id,goal_id,title,completed,position,completed_at,created_at,updated_at")
      .single();

    if (error || !row) throw new Error("Milestone could not be updated");
    return row as GoalMilestone;
  });

export const deleteGoalMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        goal_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await table(context.supabase, "goal_milestones")
      .delete()
      .eq("id", data.id)
      .eq("goal_id", data.goal_id)
      .eq("owner_id", context.userId)
      .select("id")
      .single();

    if (error) throw new Error("Milestone could not be deleted");
    return { ok: true as const };
  });
