import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  FlaskConical,
  Lightbulb,
  ListTodo,
  PackageOpen,
  Target,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspaceSearch } from "@/components/WorkspaceSearch";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  getKovaBrainSnapshot,
  type BrainBriefingItem,
  type BrainSuggestion,
} from "@/lib/kova-brain.functions";

export const Route = createFileRoute("/brain")({
  component: BrainPage,
  head: () => ({
    meta: [
      { title: "Kova Brain" },
      {
        name: "description",
        content: "A factual intelligence layer across your authorized KovaGPT workspace.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-background/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function BriefingRow({ item }: { item: BrainBriefingItem }) {
  const Icon =
    item.category === "goal"
      ? Target
      : item.category === "research"
        ? FlaskConical
        : item.category === "task"
          ? ListTodo
          : CheckCircle2;

  return (
    <Link
      to={item.href}
      className="flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 hover:bg-accent"
    >
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
        {item.urgency === "attention" ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{item.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function SuggestionRow({ item }: { item: BrainSuggestion }) {
  return (
    <Link
      to={item.href}
      className="block rounded-xl border bg-background/45 p-4 hover:bg-accent/50"
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize">
              {item.priority}
            </span>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>

          {item.evidence.length ? (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Why Kova suggested this
              </div>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {item.evidence.map((evidence) => (
                  <li key={evidence}>• {evidence}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function BrainPage() {
  const { isLoaded, isSignedIn, user } = useUser();

  const enabled = isLoaded && !!isSignedIn && !!user?.id;

  const brain = useQuery({
    queryKey: ["kova-brain", user?.id],
    queryFn: () => getKovaBrainSnapshot(),
    enabled,
    staleTime: 30_000,
  });

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-6 w-6" />
              <h1 className="text-2xl font-semibold">Kova Brain</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              A factual intelligence layer built from workspace information you authorized KovaGPT
              to access.
            </p>
          </div>

          <Link
            to="/goals"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium hover:bg-accent"
          >
            <Target className="h-4 w-4" />
            Manage goals
          </Link>
        </header>

        {enabled && user?.id ? <WorkspaceSearch key={user.id} userId={user.id} /> : null}
        {!isLoaded || (enabled && brain.isLoading) ? (
          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            <div className="h-80 animate-pulse rounded-2xl bg-muted" />
            <div className="h-80 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : !isSignedIn ? (
          <div className="mt-7 rounded-2xl border p-10 text-center">Sign in to use Kova Brain.</div>
        ) : brain.error ? (
          <div role="alert" className="mt-7 rounded-2xl border border-destructive/40 p-4">
            Kova Brain could not load your workspace.
            <button
              onClick={() => void brain.refetch()}
              className="ml-3 rounded-lg border px-3 py-1.5 text-sm"
            >
              Retry
            </button>
          </div>
        ) : brain.data ? (
          <>
            <section
              className="mt-7 rounded-2xl border bg-card/35 p-4"
              aria-labelledby="brain-state-title"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="brain-state-title" className="font-semibold">
                    Workspace state
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Live counts from authorized records. No values are invented.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  Updated{" "}
                  {new Date(brain.data.generatedAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Active goals" value={brain.data.counts.activeGoals} />
                <Stat label="Open tasks" value={brain.data.counts.openTasks} />
                <Stat label="Research" value={brain.data.counts.activeResearch} />
                <Stat label="Memories" value={brain.data.counts.memories} />
                <Stat label="Context Packs" value={brain.data.counts.contextPacks} />
                <Stat label="Library items" value={brain.data.counts.libraryItems} />
              </dl>
            </section>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border bg-card/35 p-3">
                <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                  <CalendarDays className="h-4 w-4" />
                  <div>
                    <h2 className="font-semibold">Daily Briefing</h2>
                    <p className="text-xs text-muted-foreground">
                      Current priorities derived from recorded workspace state.
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  {brain.data.briefing.map((item) => (
                    <BriefingRow key={item.id} item={item} />
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border bg-card/35 p-3">
                <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                  <Lightbulb className="h-4 w-4" />
                  <div>
                    <h2 className="font-semibold">Predictive Assistance</h2>
                    <p className="text-xs text-muted-foreground">
                      Explainable next actions based only on factual signals.
                    </p>
                  </div>
                </div>

                {brain.data.suggestions.length ? (
                  <div className="space-y-2">
                    {brain.data.suggestions.map((item) => (
                      <SuggestionRow key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl p-6 text-center">
                    <CheckCircle2 className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">
                      Nothing needs a recommendation right now
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Kova will surface suggestions when your recorded state supports one.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <section className="mt-5 rounded-2xl border bg-card/35 p-4">
              <div className="flex items-center gap-2">
                <PackageOpen className="h-4 w-4" />
                <h2 className="font-semibold">Brain principles</h2>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted/45 p-3">
                  <div className="text-sm font-medium">Authorized sources</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Brain only reads account data available through existing authenticated Kova
                    systems.
                  </p>
                </div>
                <div className="rounded-xl bg-muted/45 p-3">
                  <div className="text-sm font-medium">Explainable actions</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Recommendations expose the factual evidence that triggered them.
                  </p>
                </div>
                <div className="rounded-xl bg-muted/45 p-3">
                  <div className="text-sm font-medium">No fake predictions</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Kova distinguishes observed facts from suggestions and does not claim certainty
                    about future events.
                  </p>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
