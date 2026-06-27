import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  isScheduledTasksEligible,
  type ScheduledTask,
} from "@/lib/scheduled-tasks.functions";
import { Calendar, Clock, Plus, Trash2, Pause, Play, ArrowLeft, Lock } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/scheduled-tasks")({
  component: ScheduledTasksPage,
  head: () => ({
    meta: [
      { title: "Scheduled Tasks — KovaGPT" },
      { name: "description", content: "Schedule KovaGPT to do something for you later." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type PlanState = "loading" | "free" | "paid" | "signed-out";

function ScheduledTasksPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [plan, setPlan] = useState<PlanState>("loading");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "monthly">("none");

  const list = useServerFn(listScheduledTasks);
  const create = useServerFn(createScheduledTask);
  const update = useServerFn(updateScheduledTask);
  const remove = useServerFn(deleteScheduledTask);
  const checkEligible = useServerFn(isScheduledTasksEligible);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setPlan("signed-out");
      return;
    }
    let cancel = false;
    checkEligible({})
      .then((r) => {
        if (cancel) return;
        setPlan(r.eligible ? "paid" : "free");
      })
      .catch(() => {
        if (!cancel) setPlan("free");
      });
    return () => {
      cancel = true;
    };
  }, [isLoaded, isSignedIn, checkEligible]);

  useEffect(() => {
    if (plan !== "paid") return;
    setLoading(true);
    list({})
      .then((rows) => setTasks(rows))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, [plan, list]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !prompt.trim() || !when) return;
    setCreating(true);
    try {
      const iso = new Date(when).toISOString();
      const row = await create({ data: { title: title.trim(), prompt: prompt.trim(), run_at: iso, repeat } });
      setTasks((t) => [...t, row].sort((a, b) => a.run_at.localeCompare(b.run_at)));
      setTitle("");
      setPrompt("");
      setWhen("");
      setRepeat("none");
      toast.success("Task scheduled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule task");
    } finally {
      setCreating(false);
    }
  };

  const togglePause = async (t: ScheduledTask) => {
    const next = t.status === "paused" ? "scheduled" : "paused";
    try {
      const updated = await update({ data: { id: t.id, status: next } });
      setTasks((arr) => arr.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const del = async (t: ScheduledTask) => {
    try {
      await remove({ data: { id: t.id } });
      setTasks((arr) => arr.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <AppShell>
    <div className="min-h-screen bg-background text-foreground">
      <Toaster />
      <div className="max-w-3xl mx-auto px-4 py-8">

        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to chat
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <Calendar className="w-6 h-6" />
          <h1 className="font-display text-2xl font-semibold tracking-tight">Scheduled Tasks</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          Ask KovaGPT to do something at a specific time. Results show up in your task history.
        </p>

        {plan === "loading" && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}

        {plan === "signed-out" && (
          <div className="rounded-2xl border border-border p-6 text-center">
            <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
            <div className="font-medium mb-1">Sign in to use scheduled tasks</div>
            <p className="text-sm text-muted-foreground mb-4">
              Available on Plus, Pro, and higher plans.
            </p>
            <Link to="/" className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium">
              Go to sign in
            </Link>
          </div>
        )}

        {plan === "free" && (
          <div className="rounded-2xl border border-border p-6 text-center">
            <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
            <div className="font-medium mb-1">Scheduled Tasks is a Plus feature</div>
            <p className="text-sm text-muted-foreground mb-4">
              Upgrade to Plus, Pro, or higher to schedule Kova to do things for you later.
            </p>
            <Link to="/pricing" className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium">
              View plans
            </Link>
          </div>
        )}

        {plan === "paid" && (
          <>
            <form onSubmit={submit} className="rounded-2xl border border-border p-4 sm:p-5 mb-8 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Morning market summary"
                  className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                  maxLength={200}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">What should Kova do?</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Summarize the top 5 AI news stories from the last 24 hours."
                  className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition min-h-[90px]"
                  maxLength={4000}
                  required
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">When</label>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Repeat</label>
                  <select
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value as any)}
                    className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                  >
                    <option value="none">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 disabled:opacity-50 transition active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4" />
                  {creating ? "Scheduling…" : "Schedule"}
                </button>
              </div>
            </form>

            <h2 className="font-display text-lg font-semibold mb-3">Your scheduled tasks</h2>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nothing scheduled yet.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded-xl border border-border p-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(t.run_at).toLocaleString()} · {t.repeat === "none" ? "Once" : t.repeat}
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-accent/60">{t.status}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{t.prompt}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => togglePause(t)}
                        className="p-2 rounded-md hover:bg-accent transition"
                        aria-label={t.status === "paused" ? "Resume" : "Pause"}
                        title={t.status === "paused" ? "Resume" : "Pause"}
                      >
                        {t.status === "paused" ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => del(t)}
                        className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition"
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-6">
              Heads up: scheduled execution is being rolled out gradually. Tasks are stored safely and will run once the runner is fully enabled for your account.
            </p>
          </>
        )}
      </div>
    </div>
    </AppShell>
  );
}

