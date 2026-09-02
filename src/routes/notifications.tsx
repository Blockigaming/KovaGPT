import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, CheckCheck, Loader2, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { EmptyState, ErrorState } from "@/components/states";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  deleteNotifications,
  listNotifications,
  markNotificationsRead,
  type CenterNotification,
} from "@/lib/notification-center.functions";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [{ title: "KovaGPT Notifications" }, { name: "robots", content: "noindex" }],
  }),
  component: NotificationsRoute,
});
type Filter = "all" | "unread" | "agent" | "connector" | "scheduled";

function NotificationsRoute() {
  const { isLoaded, isSignedIn } = useUser();
  const list = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const remove = useServerFn(deleteNotifications);
  const [items, setItems] = useState<CenterNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await list());
    } catch {
      setError("Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, list]);
  useEffect(() => {
    if (isLoaded && isSignedIn) void reload();
    else if (isLoaded) setLoading(false);
  }, [isLoaded, isSignedIn, reload]);
  const unread = items.filter((item) => !item.readAt).length;
  const visible = useMemo(
    () =>
      items.filter((item) => {
        const text = `${item.title} ${item.preview} ${item.type}`.toLowerCase();
        if (search && !text.includes(search.toLowerCase())) return false;
        if (filter === "unread") return !item.readAt;
        if (filter === "agent") return item.source === "agent";
        if (filter === "connector")
          return item.type.includes("connector") || item.type.includes("reauth");
        if (filter === "scheduled")
          return item.type.includes("scheduled") || item.type.includes("task");
        return true;
      }),
    [items, filter, search],
  );
  async function read(item?: CenterNotification) {
    setBusy(item?.id ?? "all");
    try {
      await markRead({ data: item ? { ids: [item.id], source: item.source } : { source: "all" } });
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((candidate) =>
          !item || candidate.id === item.id
            ? { ...candidate, readAt: candidate.readAt ?? now }
            : candidate,
        ),
      );
    } catch {
      toast.error("Could not mark notifications as read.");
    } finally {
      setBusy(null);
    }
  }
  async function discard(item: CenterNotification) {
    setBusy(item.id);
    try {
      await remove({ data: { ids: [item.id], source: item.source } });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch {
      toast.error("Could not delete the notification.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <AppShell>
      <main
        className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6"
        aria-labelledby="notifications-title"
      >
        <section className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
          <WorkspacePageHeader
            titleId="notifications-title"
            title="Notifications"
            description="Updates from scheduled tasks, shared workspaces, and account activity."
            meta={
              <span aria-live="polite">
                {unread} unread notification{unread === 1 ? "" : "s"}
              </span>
            }
            actions={
              <button
                type="button"
                disabled={!unread || busy !== null}
                onClick={() => void read()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </button>
            }
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search notifications</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notifications"
                className="min-h-11 w-full rounded-xl border bg-background pl-10 pr-3"
              />
            </label>
            <select
              aria-label="Filter notifications"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
              className="min-h-11 rounded-xl border bg-background px-3"
            >
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="agent">Agents</option>
              <option value="connector">Connectors</option>
              <option value="scheduled">Task history</option>
            </select>
          </div>
        </section>
        {!isSignedIn && isLoaded ? (
          <EmptyState
            icon={Bell}
            title="Sign in to view notifications"
            description="Notifications are private to your account."
          />
        ) : loading ? (
          <div className="flex min-h-40 items-center justify-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="sr-only">Loading notifications</span>
          </div>
        ) : error ? (
          <ErrorState
            title="Notifications unavailable"
            description={error}
            onRetry={() => void reload()}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={items.length ? "No matching notifications" : "No notifications"}
            description={
              items.length
                ? "Try another search or filter."
                : "Agent runs, connectors, and historical task notifications will appear here."
            }
          />
        ) : (
          <ul className="divide-y rounded-3xl border bg-card">
            {visible.map((item) => (
              <li
                key={`${item.source}-${item.id}`}
                className={`p-4 sm:p-5 ${item.readAt ? "" : "bg-primary/[0.04]"}`}
              >
                <div className="flex gap-3">
                  <span
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-muted" : "bg-primary"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-medium">{item.title}</p>
                      <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.preview}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.actionUrl && (
                        <Link to={item.actionUrl} className="rounded-full border px-3 py-2 text-sm">
                          Open
                        </Link>
                      )}
                      {!item.readAt && (
                        <button
                          onClick={() => void read(item)}
                          disabled={busy === item.id}
                          className="inline-flex items-center gap-1 rounded-full border px-3 py-2 text-sm"
                        >
                          <Check className="h-4 w-4" />
                          Mark read
                        </button>
                      )}
                      <button
                        onClick={() => void discard(item)}
                        disabled={busy === item.id}
                        aria-label={`Delete ${item.title}`}
                        className="inline-flex items-center gap-1 rounded-full border px-3 py-2 text-sm text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
