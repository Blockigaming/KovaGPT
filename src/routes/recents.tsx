import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  FileText,
  FolderKanban,
  Image,
  ListTodo,
  MessageSquare,
  Pin,
  Search,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { loadConversations } from "@/lib/chat-store";
import { listWorkspaceIntelligence, type WorkspaceSignal } from "@/lib/workspace.functions";
import { loadWorkTasks } from "@/lib/work-store";

export const Route = createFileRoute("/recents")({
  component: RecentsPage,
  head: () => ({ meta: [{ title: "Recents | KovaGPT" }, { name: "robots", content: "noindex" }] }),
});
type RecentKind = WorkspaceSignal["kind"] | "chat" | "work";
type Filter = "all" | RecentKind;
const icons = {
  chat: MessageSquare,
  project: FolderKanban,
  project_chat: MessageSquare,
  file: FileText,
  artifact: FileText,
  image: Image,
  memory: FileText,
  context_pack: FileText,
  automation: ListTodo,
  research: Sparkles,
  work: ListTodo,
  prompt: Sparkles,
};
function RecentsPage() {
  const { isLoaded, isSignedIn } = useUser();
  const list = useServerFn(listWorkspaceIntelligence);
  const [remote, setRemote] = useState<WorkspaceSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    try {
      setPins(JSON.parse(localStorage.getItem("kova-recent-pins") ?? "[]"));
    } catch {
      setPins([]);
    }
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    list({})
      .then(setRemote)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Recent work could not be loaded"),
      )
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list]);
  const items = useMemo(() => {
    const chats = loadConversations().map((chat) => ({
      id: chat.id,
      type: "chat" as const,
      title: chat.title,
      subtitle: `${chat.messages.length} messages`,
      updatedAt: new Date(chat.updatedAt).toISOString(),
      href: `/?chat=${chat.id}`,
    }));
    const work = loadWorkTasks().map((task) => ({
      id: task.id,
      type: "work" as const,
      title: task.objective,
      subtitle: `${task.steps.filter((step) => step.done).length}/${task.steps.length} steps complete`,
      updatedAt: new Date(task.updatedAt).toISOString(),
      href: "/work",
    }));
    const account = remote.map((item) => ({ ...item, type: item.kind }));
    return [...chats, ...work, ...account].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }, [remote]);
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (filter === "all" || item.type === filter) &&
            `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(pins.includes(`${b.type}:${b.id}`)) - Number(pins.includes(`${a.type}:${a.id}`)),
        ),
    [items, filter, query, pins],
  );
  const groups = useMemo(
    () =>
      Object.entries(
        visible.reduce<Record<string, typeof visible>>((all, item) => {
          const age = (Date.now() - Date.parse(item.updatedAt)) / 86400000;
          const label = age < 1 ? "Today" : age < 7 ? "This week" : "Earlier";
          (all[label] ??= []).push(item);
          return all;
        }, {}),
      ),
    [visible],
  );
  const togglePin = (key: string) =>
    setPins((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      localStorage.setItem("kova-recent-pins", JSON.stringify(next));
      return next;
    });
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <header>
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Recents</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Continue authorized work across chats, projects, research, files, images, and tasks.
          </p>
        </header>
        <div className="my-6 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search recent work</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-xl border bg-background pl-9 pr-3"
              placeholder="Search recent work"
            />
          </label>
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Recent work types">
            {(
              [
                "all",
                "chat",
                "project",
                "file",
                "artifact",
                "image",
                "context_pack",
                "research",
                "automation",
                "prompt",
                "work",
              ] as Filter[]
            ).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-10 shrink-0 rounded-lg px-3 text-sm capitalize ${filter === value ? "bg-foreground text-background" : "hover:bg-accent"}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {!isSignedIn && !loading ? (
          <div className="rounded-2xl border p-8 text-center">
            <h2 className="font-semibold">Sign in for your complete workspace history</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Local chats remain visible; account-owned projects and files require sign-in.
            </p>
          </div>
        ) : loading ? (
          <div aria-label="Loading recent work" className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 p-4">
            <p>{error}</p>
            <button onClick={() => location.reload()} className="mt-2 rounded-lg border px-3 py-2">
              Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center">
            <Clock3 className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No recent work found</h2>
            <p className="text-sm text-muted-foreground">Try another filter or start a new chat.</p>
          </div>
        ) : (
          <div className="space-y-7">
            {groups.map(([label, group]) => (
              <section key={label}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </h2>
                <ul className="divide-y rounded-2xl border bg-card/40">
                  {group.map((item) => {
                    const Icon = icons[item.type];
                    const key = `${item.type}:${item.id}`;
                    return (
                      <li key={key} className="flex items-center gap-3 p-3">
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <Link
                          to={item.href}
                          onClick={() => {
                            if (item.type === "chat")
                              localStorage.setItem("nova-gpt-pending-active", item.id);
                          }}
                          className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="truncate font-medium">{item.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.subtitle} · {new Date(item.updatedAt).toLocaleString()}
                          </div>
                        </Link>
                        <button
                          onClick={() => togglePin(key)}
                          aria-label={
                            pins.includes(key) ? `Unpin ${item.title}` : `Pin ${item.title}`
                          }
                          aria-pressed={pins.includes(key)}
                          className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-accent"
                        >
                          <Pin className={`h-4 w-4 ${pins.includes(key) ? "fill-current" : ""}`} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
