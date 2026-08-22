import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BrainQueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
};

type BrainQuery = {
  select: (columns?: string, options?: unknown) => BrainQuery;
  eq: (column: string, value: unknown) => BrainQuery;
  in: (column: string, values: unknown[]) => BrainQuery;
  neq: (column: string, value: unknown) => BrainQuery;
  order: (column: string, options?: unknown) => BrainQuery;
  limit: (count: number) => Promise<BrainQueryResult>;
};

const brainTable = (supabase: unknown, name: string) =>
  (supabase as { from: (name: string) => BrainQuery }).from(name);

export type BrainGoal = {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  targetDate: string | null;
  updatedAt: string;
};

export type BrainTask = {
  id: string;
  title: string;
  source: "project" | "scheduled";
  status: string;
  dueAt: string | null;
  href: string;
};

export type BrainResearch = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

export type BrainSuggestion = {
  id: string;
  title: string;
  reason: string;
  href: string;
  evidence: string[];
  priority: "low" | "medium" | "high";
};

export type BrainBriefingItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: "goal" | "task" | "research" | "context";
  urgency: "normal" | "attention";
};

export type KovaBrainSnapshot = {
  generatedAt: string;
  counts: {
    activeGoals: number;
    openTasks: number;
    activeResearch: number;
    memories: number;
    contextPacks: number;
    libraryItems: number;
  };
  goals: BrainGoal[];
  tasks: BrainTask[];
  research: BrainResearch[];
  briefing: BrainBriefingItem[];
  suggestions: BrainSuggestion[];
};

function dueWithin(value: string | null, days: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const delta = timestamp - Date.now();
  return delta >= 0 && delta <= days * 86_400_000;
}

function overdue(value: string | null) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

export const getKovaBrainSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KovaBrainSnapshot> => {
    const [
      goalsResult,
      scheduledResult,
      membershipResult,
      researchResult,
      memoryResult,
      packsResult,
      libraryResult,
    ] = await Promise.all([
      brainTable(context.supabase, "goals")
        .select("id,title,status,priority,progress,target_date,updated_at")
        .eq("owner_id", context.userId)
        .in("status", ["active", "paused"])
        .order("updated_at", { ascending: false })
        .limit(20),

      context.supabase
        .from("scheduled_tasks")
        .select("id,title,status,next_run_at,run_at,updated_at")
        .eq("user_id", context.userId)
        .in("status", ["scheduled", "running", "paused"])
        .order("updated_at", { ascending: false })
        .limit(20),

      context.supabase.from("project_members").select("project_id").eq("user_id", context.userId),

      brainTable(context.supabase, "deep_research_runs")
        .select("id,query,status,updated_at")
        .eq("user_id", context.userId)
        .in("status", ["queued", "running", "paused"])
        .order("updated_at", { ascending: false })
        .limit(12),

      context.supabase.from("project_memory").select("id", { count: "exact", head: true }),

      brainTable(context.supabase, "context_packs")
        .select("id", { count: "exact" })
        .eq("user_id", context.userId)
        .limit(1),

      context.supabase
        .from("user_library_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId),
    ]);

    const criticalError = [
      goalsResult,
      scheduledResult,
      membershipResult,
      researchResult,
      packsResult,
      libraryResult,
    ].find((result) => result.error);

    if (criticalError?.error) {
      throw new Error("Kova Brain could not load authorized workspace state");
    }

    const projectIds = (membershipResult.data ?? []).map(
      (row: { project_id: string }) => row.project_id,
    );

    let projectTasks: Array<{
      id: string;
      title: string;
      status: string;
      due_date: string | null;
      project_id: string;
    }> = [];

    if (projectIds.length) {
      const projectTaskResult = await context.supabase
        .from("project_tasks")
        .select("id,title,status,due_date,project_id")
        .in("project_id", projectIds)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(30);

      if (projectTaskResult.error) {
        throw new Error("Kova Brain could not load project tasks");
      }

      projectTasks = projectTaskResult.data ?? [];
    }

    const goalRows = (goalsResult.data ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      progress: number;
      target_date: string | null;
      updated_at: string;
    }>;

    const goals: BrainGoal[] = goalRows.map(
      (goal: {
        id: string;
        title: string;
        status: string;
        priority: string;
        progress: number;
        target_date: string | null;
        updated_at: string;
      }) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        progress: goal.progress,
        targetDate: goal.target_date,
        updatedAt: goal.updated_at,
      }),
    );

    const scheduledTasks: BrainTask[] = (scheduledResult.data ?? []).map(
      (task: {
        id: string;
        title: string;
        status: string;
        next_run_at?: string | null;
        run_at?: string | null;
      }) => ({
        id: task.id,
        title: task.title,
        source: "scheduled" as const,
        status: task.status,
        dueAt: task.next_run_at ?? task.run_at ?? null,
        href: "/scheduled-tasks",
      }),
    );

    const projectTaskItems: BrainTask[] = projectTasks.map((task) => ({
      id: task.id,
      title: task.title,
      source: "project",
      status: task.status,
      dueAt: task.due_date,
      href: `/projects/${task.project_id}`,
    }));

    const tasks = [...projectTaskItems, ...scheduledTasks].sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    });

    const researchRows = (researchResult.data ?? []) as Array<{
      id: string;
      query: string;
      status: string;
      updated_at: string;
    }>;

    const research: BrainResearch[] = researchRows.map(
      (run: { id: string; query: string; status: string; updated_at: string }) => ({
        id: run.id,
        title: run.query,
        status: run.status,
        updatedAt: run.updated_at,
      }),
    );

    const briefing: BrainBriefingItem[] = [];
    const suggestions: BrainSuggestion[] = [];

    const overdueTasks = tasks.filter((task) => overdue(task.dueAt));
    const soonTasks = tasks.filter((task) => !overdue(task.dueAt) && dueWithin(task.dueAt, 2));
    const upcomingGoals = goals.filter((goal) => dueWithin(goal.targetDate, 7));
    const stalledGoals = goals.filter(
      (goal) =>
        goal.status === "active" &&
        goal.progress < 25 &&
        Date.now() - Date.parse(goal.updatedAt) > 7 * 86_400_000,
    );

    for (const task of overdueTasks.slice(0, 3)) {
      briefing.push({
        id: `overdue:${task.source}:${task.id}`,
        title: `Overdue: ${task.title}`,
        detail: "This open task is past its recorded due time.",
        href: task.href,
        category: "task",
        urgency: "attention",
      });
    }

    for (const task of soonTasks.slice(0, 3)) {
      briefing.push({
        id: `soon:${task.source}:${task.id}`,
        title: task.title,
        detail: "This open task is due within the next two days.",
        href: task.href,
        category: "task",
        urgency: "normal",
      });
    }

    for (const goal of upcomingGoals.slice(0, 3)) {
      briefing.push({
        id: `goal:${goal.id}`,
        title: goal.title,
        detail: `${goal.progress}% complete · target date is within seven days.`,
        href: "/goals",
        category: "goal",
        urgency: goal.progress < 75 ? "attention" : "normal",
      });
    }

    for (const run of research.slice(0, 2)) {
      briefing.push({
        id: `research:${run.id}`,
        title: run.title,
        detail: `Research status: ${run.status}.`,
        href: "/research-planner",
        category: "research",
        urgency: "normal",
      });
    }

    if (overdueTasks.length) {
      suggestions.push({
        id: "resolve-overdue-tasks",
        title: "Review overdue work",
        reason: `${overdueTasks.length} open ${
          overdueTasks.length === 1 ? "task is" : "tasks are"
        } past the recorded due time.`,
        href: overdueTasks[0]?.href ?? "/work",
        evidence: overdueTasks.slice(0, 3).map((task) => task.title),
        priority: "high",
      });
    }

    if (upcomingGoals.some((goal) => goal.progress < 75)) {
      const atRisk = upcomingGoals.filter((goal) => goal.progress < 75);
      suggestions.push({
        id: "focus-upcoming-goals",
        title: "Focus on an approaching goal",
        reason: `${atRisk.length} ${
          atRisk.length === 1 ? "goal has" : "goals have"
        } a target date within seven days and less than 75% recorded progress.`,
        href: "/goals",
        evidence: atRisk.slice(0, 3).map((goal) => `${goal.title} · ${goal.progress}%`),
        priority: "high",
      });
    }

    if (stalledGoals.length) {
      suggestions.push({
        id: "review-stalled-goals",
        title: "Review low-progress goals",
        reason: "Some active goals have low recorded progress and have not been updated recently.",
        href: "/goals",
        evidence: stalledGoals.slice(0, 3).map((goal) => `${goal.title} · ${goal.progress}%`),
        priority: "medium",
      });
    }

    if (!goals.length) {
      suggestions.push({
        id: "create-first-goal",
        title: "Create your first goal",
        reason: "Kova Brain has no saved goals to use when prioritizing your workspace.",
        href: "/goals",
        evidence: ["No active or paused goals are currently saved."],
        priority: "medium",
      });
    }

    if (!tasks.length && goals.length) {
      suggestions.push({
        id: "connect-goal-to-work",
        title: "Turn a goal into concrete work",
        reason:
          "You have active goals but no open project or scheduled tasks in the current workspace state.",
        href: "/work",
        evidence: goals.slice(0, 3).map((goal) => goal.title),
        priority: "medium",
      });
    }

    if (!research.length && goals.some((goal) => goal.priority === "high")) {
      suggestions.push({
        id: "research-high-priority-goal",
        title: "Research a high-priority goal",
        reason:
          "At least one active goal is marked high priority and there is no active research run.",
        href: "/research-planner",
        evidence: goals
          .filter((goal) => goal.priority === "high")
          .slice(0, 3)
          .map((goal) => goal.title),
        priority: "low",
      });
    }

    const memories = memoryResult.count ?? 0;
    const contextPacks = packsResult.count ?? 0;
    const libraryItems = libraryResult.count ?? 0;

    if (!briefing.length) {
      briefing.push({
        id: "workspace-steady",
        title: "No urgent workspace items detected",
        detail:
          "Kova Brain found no overdue tasks, approaching goal targets, or active research requiring attention.",
        href: "/summary",
        category: "context",
        urgency: "normal",
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        activeGoals: goals.length,
        openTasks: tasks.length,
        activeResearch: research.length,
        memories,
        contextPacks,
        libraryItems,
      },
      goals,
      tasks: tasks.slice(0, 12),
      research,
      briefing: briefing.slice(0, 8),
      suggestions: suggestions.slice(0, 6),
    };
  });
