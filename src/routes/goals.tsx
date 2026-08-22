import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Check, Circle, Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  deleteGoalMilestone,
  listGoals,
  updateGoal,
  updateGoalMilestone,
  type Goal,
  type GoalStatus,
} from "@/lib/goals.functions";

export const Route = createFileRoute("/goals")({
  component: GoalsPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Goals" },
      {
        name: "description",
        content: "Track durable goals, milestones, priorities, and progress.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function GoalsPage() {
  const { isLoaded, isSignedIn } = useUser();

  const list = useServerFn(listGoals);
  const create = useServerFn(createGoal);
  const update = useServerFn(updateGoal);
  const remove = useServerFn(deleteGoal);
  const createMilestone = useServerFn(createGoalMilestone);
  const updateMilestone = useServerFn(updateGoalMilestone);
  const removeMilestone = useServerFn(deleteGoalMilestone);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [milestoneDraft, setMilestoneDraft] = useState<Record<string, string>>({});

  const refresh = async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      setGoals(await list({}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Goals could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  const visible = useMemo(
    () =>
      goals.filter((goal) => filter === "all" || !["completed", "archived"].includes(goal.status)),
    [filter, goals],
  );

  const addGoal = async () => {
    const value = title.trim();
    if (!value) return;
    setCreating(true);
    try {
      const goal = await create({
        data: {
          title: value,
          description: "",
          priority: "medium",
        },
      });
      setGoals((all) => [goal, ...all]);
      setTitle("");
      toast.success("Goal created");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Goal could not be created");
    } finally {
      setCreating(false);
    }
  };

  const patchGoal = async (
    goal: Goal,
    patch: Partial<{
      status: GoalStatus;
      progress: number;
      priority: "low" | "medium" | "high";
    }>,
  ) => {
    const previous = goals;
    setGoals((all) => all.map((item) => (item.id === goal.id ? { ...item, ...patch } : item)));

    try {
      await update({ data: { id: goal.id, ...patch } });
    } catch (reason) {
      setGoals(previous);
      toast.error(reason instanceof Error ? reason.message : "Goal could not be updated");
    }
  };

  const addMilestone = async (goal: Goal) => {
    const value = (milestoneDraft[goal.id] ?? "").trim();
    if (!value) return;

    try {
      const milestone = await createMilestone({
        data: { goal_id: goal.id, title: value },
      });
      setGoals((all) =>
        all.map((item) =>
          item.id === goal.id ? { ...item, milestones: [...item.milestones, milestone] } : item,
        ),
      );
      setMilestoneDraft((all) => ({ ...all, [goal.id]: "" }));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Milestone could not be created");
    }
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={Target}
          title="Goals"
          description="Turn long-term objectives into durable, factual progress that Kova can use as authorized context."
        />

        {!isSignedIn && !loading ? (
          <div className="mt-6 rounded-2xl border p-10 text-center">
            Sign in to create and track goals.
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-2xl border bg-card/35 p-4">
              <label className="text-sm font-medium" htmlFor="new-goal-title">
                New goal
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="new-goal-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addGoal();
                  }}
                  maxLength={200}
                  placeholder="What do you want to accomplish?"
                  className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3"
                />
                <button
                  disabled={creating || !title.trim()}
                  onClick={() => void addGoal()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </section>

            <div className="my-5 flex gap-2">
              {(["open", "all"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`min-h-10 rounded-lg px-3 text-sm capitalize ${
                    filter === value ? "bg-foreground text-background" : "border hover:bg-accent"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            {loading ? (
              <div aria-label="Loading goals" className="space-y-3">
                {[1, 2, 3].map((value) => (
                  <div key={value} className="h-36 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : error ? (
              <div role="alert" className="rounded-2xl border border-destructive/40 p-4">
                {error}
                <button
                  onClick={() => void refresh()}
                  className="ml-3 rounded-lg border px-3 py-1.5 text-sm"
                >
                  Retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border p-10 text-center">
                <Target className="mx-auto h-6 w-6 text-muted-foreground" />
                <h2 className="mt-3 font-semibold">No goals here yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a goal above. Kova only uses goals you explicitly save.
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {visible.map((goal) => {
                  const completed = goal.milestones.filter((item) => item.completed).length;
                  const derivedProgress = goal.milestones.length
                    ? Math.round((completed / goal.milestones.length) * 100)
                    : goal.progress;

                  return (
                    <li key={goal.id} className="rounded-2xl border bg-card/35 p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <button
                          aria-label={
                            goal.status === "completed"
                              ? `Reopen ${goal.title}`
                              : `Complete ${goal.title}`
                          }
                          onClick={() =>
                            void patchGoal(goal, {
                              status: goal.status === "completed" ? "active" : "completed",
                              progress: goal.status === "completed" ? derivedProgress : 100,
                            })
                          }
                          className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-accent"
                        >
                          {goal.status === "completed" ? (
                            <Check className="h-5 w-5" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold">{goal.title}</h2>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                              {goal.priority}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                              {goal.status}
                            </span>
                          </div>

                          {goal.description ? (
                            <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
                          ) : null}

                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Progress</span>
                              <span>{derivedProgress}%</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-foreground transition-[width]"
                                style={{
                                  width: `${Math.max(0, Math.min(100, derivedProgress))}%`,
                                }}
                              />
                            </div>
                          </div>

                          <ul className="mt-4 space-y-1">
                            {goal.milestones.map((milestone) => (
                              <li
                                key={milestone.id}
                                className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-accent/60"
                              >
                                <input
                                  type="checkbox"
                                  checked={milestone.completed}
                                  aria-label={`Complete ${milestone.title}`}
                                  onChange={async () => {
                                    try {
                                      const next = await updateMilestone({
                                        data: {
                                          id: milestone.id,
                                          goal_id: goal.id,
                                          completed: !milestone.completed,
                                        },
                                      });

                                      setGoals((all) =>
                                        all.map((item) =>
                                          item.id === goal.id
                                            ? {
                                                ...item,
                                                milestones: item.milestones.map((m) =>
                                                  m.id === milestone.id ? next : m,
                                                ),
                                              }
                                            : item,
                                        ),
                                      );
                                    } catch (reason) {
                                      toast.error(
                                        reason instanceof Error
                                          ? reason.message
                                          : "Milestone could not be updated",
                                      );
                                    }
                                  }}
                                />
                                <span
                                  className={`flex-1 text-sm ${
                                    milestone.completed ? "text-muted-foreground line-through" : ""
                                  }`}
                                >
                                  {milestone.title}
                                </span>
                                <button
                                  aria-label={`Delete ${milestone.title}`}
                                  onClick={async () => {
                                    try {
                                      await removeMilestone({
                                        data: {
                                          id: milestone.id,
                                          goal_id: goal.id,
                                        },
                                      });
                                      setGoals((all) =>
                                        all.map((item) =>
                                          item.id === goal.id
                                            ? {
                                                ...item,
                                                milestones: item.milestones.filter(
                                                  (m) => m.id !== milestone.id,
                                                ),
                                              }
                                            : item,
                                        ),
                                      );
                                    } catch (reason) {
                                      toast.error(
                                        reason instanceof Error
                                          ? reason.message
                                          : "Milestone could not be deleted",
                                      );
                                    }
                                  }}
                                  className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </li>
                            ))}
                          </ul>

                          <div className="mt-2 flex gap-2">
                            <input
                              value={milestoneDraft[goal.id] ?? ""}
                              onChange={(event) =>
                                setMilestoneDraft((all) => ({
                                  ...all,
                                  [goal.id]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void addMilestone(goal);
                              }}
                              maxLength={240}
                              placeholder="Add milestone"
                              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
                            />
                            <button
                              onClick={() => void addMilestone(goal)}
                              className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <button
                          aria-label={`Delete ${goal.title}`}
                          onClick={async () => {
                            try {
                              await remove({ data: { id: goal.id } });
                              setGoals((all) => all.filter((item) => item.id !== goal.id));
                              toast.success("Goal deleted");
                            } catch (reason) {
                              toast.error(
                                reason instanceof Error
                                  ? reason.message
                                  : "Goal could not be deleted",
                              );
                            }
                          }}
                          className="grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
