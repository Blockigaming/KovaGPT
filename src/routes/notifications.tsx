import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, CheckCheck, Loader2, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { EmptyState, ErrorState } from "@/components/states";
import { useUser } from "@/components/auth/ClerkSafe";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { formatDisplayDateTime } from "@/lib/time-format";
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
  const { isLoaded, isSignedIn, user } = useUser();
  const timeFormat = useTimeFormatPreference(user?.id ?? null, isLoaded);
  const principalId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const list = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const remove = useServerFn(deleteNotifications);
  const [items, setItems] = useState<CenterNotification[]>([]);
  const [itemsOwner, setItemsOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const generationRef = useRef(0);
  const activePrincipalRef = useRef(principalId);
  activePrincipalRef.current = principalId;

  const reload = useCallback(async () => {
    const expectedPrincipal = principalId;
    if (!isLoaded || !isSignedIn || !expectedPrincipal) return;
    const generation = ++generationRef.current;
    setItems([]);
    setItemsOwner(expectedPrincipal);
    setLoading(true);
    setError(null);
    try {
      const nextItems = await list();
      if (generation !== generationRef.current || activePrincipalRef.current !== expectedPrincipal)
        return;
      if (!Array.isArray(nextItems)) throw new Error();
      setItems(nextItems);
    } catch {
      if (generation !== generationRef.current || activePrincipalRef.current !== expectedPrincipal)
        return;
      setError("Notifications could not be loaded.");
    } finally {
      if (generation === generationRef.current && activePrincipalRef.current === expectedPrincipal)
        setLoading(false);
    }
  }, [isLoaded, isSignedIn, list, principalId]);

  useEffect(() => {
    if (!isLoaded || !principalId) {
      generationRef.current += 1;
      setItems([]);
      setItemsOwner(null);
      setError(null);
      setBusy(null);
      setLoading(!isLoaded);
      return;
    }
    void reload();
  }, [isLoaded, principalId, reload]);

  const visibleItems = useMemo(
    () => (isLoaded && isSignedIn && itemsOwner === principalId ? items : []),
    [isLoaded, isSignedIn, items, itemsOwner, principalId],
  );
  const principalPending =
    !isLoaded || (isSignedIn && (!principalId || itemsOwner !== principalId));
  const unread = visibleItems.filter((item) => !item.readAt).length;
  const visible = useMemo(
    () =>
      visibleItems.filter((item) => {
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
    [visibleItems, filter, search],
  );
  async function read(item?: CenterNotification) {
    const expectedPrincipal = principalId;
    if (!expectedPrincipal) return;
    setBusy(item?.id ?? "all");
    try {
      await markRead({ data: item ? { ids: [item.id], source: item.source } : { source: "all" } });
      if (activePrincipalRef.current !== expectedPrincipal) return;
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((candidate) =>
          !item || candidate.id === item.id
            ? { ...candidate, readAt: candidate.readAt ?? now }
            : candidate,
        ),
      );
    } catch {
      if (activePrincipalRef.current === expectedPrincipal)
        toast.error("Could not mark notifications as read.");
    } finally {
      if (activePrincipalRef.current === expectedPrincipal) setBusy(null);
    }
  }
  async function discard(item: CenterNotification) {
    const expectedPrincipal = principalId;
    if (!expectedPrincipal) return;
    setBusy(item.id);
    try {
      await remove({ data: { ids: [item.id], source: item.source } });
      if (activePrincipalRef.current !== expectedPrincipal) return;
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch {
      if (activePrincipalRef.current === expectedPrincipal)
        toast.error("Could not delete the notification.");
    } finally {
      if (activePrincipalRef.current === expectedPrincipal) setBusy(null);
    }
  }
  return (
    <AppShell>
      <main
        data-ui-reference="chatgpt.activity.notifications"
        className={
          "kova-tool-page " + "mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6"
        }
        aria-labelledby="notifications-title"
      >
        <section
          className={"kova-tool-panel " + "rounded-xl border border-border bg-card/40 p-4 sm:p-5"}
        >
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
              <Button
                variant="outline"
                type="button"
                disabled={!unread || busy !== null}
                onClick={() => void read()}
                className="inline-flex  items-center gap-2  border  text-sm disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </Button>
            }
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search notifications</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notifications"
                className=" w-full  border bg-background pl-10 pr-3"
              />
            </label>
            <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <SelectTrigger aria-label="Filter notifications" className="sm:w-auto sm:min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="agent">Agents</SelectItem>
                <SelectItem value="connector">Connectors</SelectItem>
                <SelectItem value="scheduled">Task history</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
        {principalPending || loading ? (
          <div className="flex min-h-40 items-center justify-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="sr-only">Loading notifications</span>
          </div>
        ) : !isSignedIn ? (
          <EmptyState
            icon={Bell}
            title="Sign in to view notifications"
            description="Notifications are private to your account."
          />
        ) : error ? (
          <ErrorState
            title="Notifications unavailable"
            description={error}
            onRetry={() => void reload()}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={visibleItems.length ? "No matching notifications" : "No notifications"}
            description={
              visibleItems.length
                ? "Try another search or filter."
                : "Agent runs, connectors, and historical task notifications will appear here."
            }
          />
        ) : (
          <ul className={"kova-tool-list " + "divide-y rounded-3xl border bg-card"}>
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
                        {formatDisplayDateTime(item.createdAt, timeFormat)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.preview}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.actionUrl && (
                        <Link
                          to={item.actionUrl}
                          className="kova-button rounded-full border px-3 py-2 text-sm"
                        >
                          Open
                        </Link>
                      )}
                      {!item.readAt && (
                        <Button
                          variant="outline"
                          onClick={() => void read(item)}
                          disabled={busy === item.id}
                          className="inline-flex items-center gap-1  border   text-sm"
                        >
                          <Check className="h-4 w-4" />
                          Mark read
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => void discard(item)}
                        disabled={busy === item.id}
                        aria-label={`Delete ${item.title}`}
                        className="inline-flex items-center gap-1  border   text-sm text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
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
