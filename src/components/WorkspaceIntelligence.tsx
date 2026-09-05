import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Boxes,
  Brain,
  BriefcaseBusiness,
  FileText,
  FolderKanban,
  Image,
  ListTodo,
  MessageSquare,
  FlaskConical,
  Sparkles,
  Target,
} from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";
import { chatStoragePrincipal, loadConversations, savePendingActive } from "@/lib/chat-store";
import { loadWorkTasks } from "@/lib/work-store";
import { listWorkspaceIntelligence, type WorkspaceSignal } from "@/lib/workspace.functions";
import { TitanWorkspaceSystems } from "@/components/TitanWorkspaceSystems";
import { useWorkStoreRevision } from "@/hooks/use-work-store-revision";

const iconByKind = {
  project: FolderKanban,
  project_chat: MessageSquare,
  file: FileText,
  artifact: FileText,
  image: Image,
  memory: Brain,
  context_pack: Boxes,
  research: Sparkles,
  automation: ListTodo,
  prompt: FlaskConical,
  goal: Target,
  work: BriefcaseBusiness,
  chat: MessageSquare,
} as const;

type DashboardItem =
  | WorkspaceSignal
  | {
      id: string;
      kind: "work" | "chat";
      title: string;
      subtitle: string;
      href: string;
      updatedAt: string;
      status?: string;
    };

const EMPTY_WORKSPACE_SIGNALS: WorkspaceSignal[] = [];

function IntelligenceRow({ item, userKey }: { item: DashboardItem; userKey: string | null }) {
  const Icon = iconByKind[item.kind];
  return (
    <Link
      to={item.href}
      onClick={() => {
        if (item.kind === "chat") {
          try {
            savePendingActive(userKey, item.id);
          } catch {
            // Navigation still works when browser storage is unavailable.
          }
        }
      }}
      className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
      </span>
      {item.status ? (
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] capitalize">
          {item.status.replaceAll("_", " ")}
        </span>
      ) : null}
    </Link>
  );
}

function WorkspaceTimeline({ items }: { items: DashboardItem[] }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const cutoff = Date.now() - days * 86400000;
  const windowItems = items.filter((item) => Date.parse(item.updatedAt) >= cutoff);
  const projects = new Set(
    windowItems.map((item) => ("projectId" in item ? item.projectId : undefined)).filter(Boolean),
  );
  const active = windowItems.filter(
    (item) => item.kind === "work" || item.kind === "research" || item.kind === "automation",
  ).length;
  const reusable = windowItems.filter((item) =>
    ["context_pack", "memory", "artifact", "file"].includes(item.kind),
  ).length;
  const groups = Object.entries(
    windowItems.reduce<Record<string, DashboardItem[]>>((all, item) => {
      const key = new Date(item.updatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      (all[key] ??= []).push(item);
      return all;
    }, {}),
  ).slice(0, 8);
  const exportTimeline = () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      "timestamp,type,title,status",
      ...windowItems.map((item) =>
        [item.updatedAt, item.kind, item.title, item.status ?? ""]
          .map((value) => quote(String(value)))
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kova-workspace-timeline-${days}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section
      className="mb-4 rounded-2xl border bg-card/35 p-3"
      aria-labelledby="workspace-timeline-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="workspace-timeline-title" className="text-sm font-semibold">
            Workspace Timeline
          </h3>
          <p className="text-xs text-muted-foreground">
            A factual replay of activity across your authorized workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Timeline range">
            {([7, 30, 90] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDays(range)}
                aria-pressed={days === range}
                className={`min-h-9 rounded-md px-2 text-xs ${days === range ? "bg-foreground text-background" : "hover:bg-accent"}`}
              >
                {range}d
              </button>
            ))}
          </div>
          <button
            disabled={!windowItems.length}
            onClick={exportTimeline}
            className="min-h-10 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Activity", windowItems.length],
          ["Active workflows", active],
          ["Projects touched", projects.size],
          ["Reusable context", reusable],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-muted/45 p-3">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {groups.length ? (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Workspace activity replay">
          {groups.map(([date, entries]) => (
            <li key={date} className="min-w-36 rounded-xl border bg-background/50 p-3">
              <div className="text-xs font-semibold">{date}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {entries.length} {entries.length === 1 ? "activity" : "activities"}
              </div>
              <div
                className="mt-2 flex -space-x-1"
                aria-label={[...new Set(entries.map((entry) => entry.kind))].join(", ")}
              >
                {[...new Set(entries.map((entry) => entry.kind))].slice(0, 5).map((kind) => {
                  const Icon = iconByKind[kind];
                  return (
                    <span
                      key={kind}
                      className="grid h-7 w-7 place-items-center rounded-full border bg-background"
                      title={kind.replaceAll("_", " ")}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No activity occurred in this time range.
        </p>
      )}
    </section>
  );
}

export function WorkspaceIntelligence() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const workRevision = useWorkStoreRevision(userKey);
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const list = useServerFn(listWorkspaceIntelligence);
  const [remoteState, setRemoteState] = useState<{
    principal: string | null;
    items: WorkspaceSignal[];
  }>({ principal: null, items: [] });
  const remote =
    principal !== null && remoteState.principal === principal
      ? remoteState.items
      : EMPTY_WORKSPACE_SIGNALS;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isLoaded || principal === null) {
      setRemoteState({ principal: null, items: [] });
      setLoading(true);
      setError(null);
      return;
    }
    if (!isSignedIn) {
      setRemoteState({ principal, items: [] });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    list({})
      .then((items) => {
        if (!cancelled) setRemoteState({ principal, items });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "Workspace activity could not be loaded",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, list, principal]);
  const local = useMemo<DashboardItem[]>(() => {
    void workRevision; // Invalidate the storage snapshot after a durable sync update.
    if (!isLoaded || !isSignedIn) return [];
    const work = loadWorkTasks(userKey)
      .filter((task) => task.status === "planning" || task.status === "paused")
      .map((task) => ({
        id: task.id,
        kind: "work" as const,
        title: task.objective,
        subtitle: `${task.steps.filter((step) => step.done).length}/${task.steps.length} steps complete`,
        href: "/work",
        updatedAt: new Date(task.updatedAt).toISOString(),
        status: task.status,
      }));
    const chats = loadConversations(userKey)
      .slice(0, 4)
      .map((chat) => ({
        id: chat.id,
        kind: "chat" as const,
        title: chat.title,
        subtitle: `${chat.messages.length} messages`,
        href: "/",
        updatedAt: new Date(chat.updatedAt).toISOString(),
      }));
    return [...work, ...chats];
  }, [isLoaded, isSignedIn, userKey, workRevision]);
  const combined = useMemo(
    () => [...local, ...remote].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [local, remote],
  );
  const active = combined
    .filter(
      (item) =>
        item.kind === "work" ||
        (item.kind === "research" &&
          !["complete", "failed", "cancelled", "canceled"].includes(item.status ?? "")) ||
        (item.kind === "automation" &&
          ["scheduled", "running", "paused"].includes(item.status ?? "")),
    )
    .slice(0, 5);
  const recent = combined
    .filter(
      (item) =>
        !active.some((activeItem) => activeItem.id === item.id && activeItem.kind === item.kind),
    )
    .slice(0, 8);
  if (!isLoaded || !isSignedIn) return null;
  return (
    <section
      className="mx-auto mt-7 w-full max-w-[56rem] px-1 pb-6"
      aria-labelledby="workspace-intelligence-title"
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="workspace-intelligence-title" className="font-semibold">
            Workspace Intelligence
          </h2>
          <p className="text-xs text-muted-foreground">
            Real activity from your account and this device.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/brain" className="text-sm font-medium hover:underline">
            Open Kova Brain
          </Link>
          <Link to="/library" className="text-sm font-medium hover:underline">
            View full library
          </Link>
        </div>
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Loading workspace intelligence">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-3 text-sm">
          {error}
        </div>
      ) : combined.length === 0 ? (
        <div className="rounded-2xl border p-7 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Your workspace is ready</p>
          <p className="text-xs text-muted-foreground">
            Projects, research, files, tasks, and saved work will appear here.
          </p>
        </div>
      ) : (
        <>
          <WorkspaceTimeline items={combined} />
          <TitanWorkspaceSystems items={combined} />
          <div className="grid gap-4 lg:grid-cols-2">
            {active.length ? (
              <section className="rounded-2xl border bg-card/35 p-2">
                <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Continue working
                </h3>
                {active.map((item) => (
                  <IntelligenceRow key={`${item.kind}:${item.id}`} item={item} userKey={userKey} />
                ))}
              </section>
            ) : null}
            <section className="rounded-2xl border bg-card/35 p-2">
              <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent and important
              </h3>
              {recent.slice(0, active.length ? 5 : 8).map((item) => (
                <IntelligenceRow key={`${item.kind}:${item.id}`} item={item} userKey={userKey} />
              ))}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

export function RelatedWorkspaceItems({
  projectId,
  kinds,
  title = "Related workspace",
}: {
  projectId?: string;
  kinds?: WorkspaceSignal["kind"][];
  title?: string;
}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const list = useServerFn(listWorkspaceIntelligence);
  const [itemState, setItemState] = useState<{
    principal: string | null;
    items: WorkspaceSignal[];
  }>({ principal: null, items: [] });
  const items = principal !== null && itemState.principal === principal ? itemState.items : [];
  const [loading, setLoading] = useState(true);
  const kindsKey = kinds?.join(",") ?? "";
  useEffect(() => {
    if (!isLoaded || principal === null || !isSignedIn) {
      setItemState({ principal: null, items: [] });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const allowedKinds = kindsKey ? kindsKey.split(",") : null;
    list({})
      .then((signals) => {
        if (cancelled) return;
        setItemState({
          principal,
          items: signals
            .filter(
              (item) =>
                (!projectId || item.projectId === projectId) &&
                (!allowedKinds || allowedKinds.includes(item.kind)),
            )
            .slice(0, 6),
        });
      })
      .catch(() => {
        if (!cancelled) setItemState({ principal, items: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, kindsKey, list, principal, projectId]);
  if (!isLoaded || !isSignedIn) return null;
  return (
    <aside className="mt-6 rounded-2xl border bg-card/30 p-2" aria-label={title}>
      <h2 className="px-3 pb-1 pt-2 text-sm font-semibold">{title}</h2>
      {loading ? (
        <div className="m-3 h-14 animate-pulse rounded-xl bg-muted" />
      ) : items.length ? (
        items.map((item) => (
          <IntelligenceRow key={`${item.kind}:${item.id}`} item={item} userKey={userKey} />
        ))
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">No explicit related items yet.</p>
      )}
    </aside>
  );
}
