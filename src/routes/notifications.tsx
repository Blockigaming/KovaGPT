import { useCollectionPager } from "@/lib/use-collection-pager";
import { CollectionPageControls } from "@/components/CollectionPageControls";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, CheckCheck, Loader2, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { EmptyState, ErrorState } from "@/components/states";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  deleteNotifications,
  listNotifications,
  markNotificationsRead,
  readNotificationDetails,
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
  const principalId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const list = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const remove = useServerFn(deleteNotifications);
  const getDetails = useServerFn(readNotificationDetails);
  const [details, setDetails] = useState<{ owner: string; id: string; body: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const detailRead = useRef({ sequence: 0, controller: null as AbortController | null });
  useEffect(() => {
    setDetails(null);
    setDetailLoading(null);
    const request = detailRead.current;
    request.sequence++;
    request.controller?.abort();
    return () => {
      request.sequence++;
      request.controller?.abort();
    };
  }, [principalId]);
  const revealDetails = async (item: CenterNotification) => {
    const owner = principalId;
    if (!owner || item.source !== "agent") return;
    const request = detailRead.current,
      sequence = ++request.sequence;
    request.controller?.abort();
    if (details?.owner === owner && details.id === item.id) {
      setDetails(null);
      setDetailLoading(null);
      return;
    }
    const controller = new AbortController();
    request.controller = controller;
    setDetailLoading(item.id);
    const current = () =>
      request.sequence === sequence &&
      activePrincipalRef.current === owner &&
      !controller.signal.aborted;
    try {
      const saved = await getDetails({ data: { id: item.id }, signal: controller.signal });
      if (!current()) return;
      if (saved.id !== item.id || typeof saved.body !== "string")
        throw new Error("Notification details are unavailable.");
      setDetails({ owner, id: saved.id, body: saved.body });
    } catch (reason) {
      if (current())
        toast.error(reason instanceof Error ? reason.message : "Notification details unavailable.");
    } finally {
      if (current()) {
        setDetailLoading(null);
        request.controller = null;
      }
    }
  };

  const [applicationItems, setApplicationItems] = useState<CenterNotification[]>([]);
  const [agentItems, setAgentItems] = useState<CenterNotification[]>([]);
  const items = useMemo(
    () =>
      [...applicationItems, ...agentItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [applicationItems, agentItems],
  );
  const setItems = useCallback(
    (value: CenterNotification[] | ((items: CenterNotification[]) => CenterNotification[])) => {
      setApplicationItems((old) =>
        typeof value === "function"
          ? value(old)
          : value.filter((item) => item.source === "application"),
      );
      setAgentItems((old) =>
        typeof value === "function" ? value(old) : value.filter((item) => item.source === "agent"),
      );
    },
    [],
  );
  const applicationPage = useCallback(
    (options: { data: { cursor: string | null }; signal?: AbortSignal }) =>
      list({ ...options, data: { ...options.data, source: "application" } }),
    [list],
  );
  const agentPage = useCallback(
    (options: { data: { cursor: string | null }; signal?: AbortSignal }) =>
      list({ ...options, data: { ...options.data, source: "agent" } }),
    [list],
  );
  const applicationPager = useCollectionPager(applicationPage, principalId, setApplicationItems);
  const agentPager = useCollectionPager(agentPage, principalId, setAgentItems);
  const readApplication = applicationPager.read,
    readAgent = agentPager.read;
  const mutationPending = useRef(false);
  const [itemsOwner, setItemsOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const error =
    applicationPager.error && agentPager.error
      ? "Both notification sources are unavailable. Retry sources below."
      : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const generationRef = useRef(0);
  const activePrincipalRef = useRef(principalId);
  activePrincipalRef.current = principalId;
  useEffect(
    () => () => {
      activePrincipalRef.current = null;
      generationRef.current++;
    },
    [],
  );

  const reload = useCallback(async () => {
    const expectedPrincipal = principalId;
    if (!isLoaded || !isSignedIn || !expectedPrincipal) return;
    const generation = ++generationRef.current;
    setItems([]);
    setItemsOwner(expectedPrincipal);
    setLoading(true);
    try {
      await Promise.allSettled([readApplication(), readAgent()]);
      if (generation !== generationRef.current || activePrincipalRef.current !== expectedPrincipal)
        return;
    } finally {
      if (generation === generationRef.current && activePrincipalRef.current === expectedPrincipal)
        setLoading(false);
    }
  }, [isLoaded, isSignedIn, readApplication, readAgent, principalId, setItems]);

  useEffect(() => {
    if (!isLoaded || !principalId) {
      generationRef.current += 1;
      setItems([]);
      setItemsOwner(null);
      setBusy(null);
      setLoading(!isLoaded);
      return;
    }
    void reload();
  }, [isLoaded, principalId, reload, setItems]);

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
    if (!expectedPrincipal || mutationPending.current) return;
    mutationPending.current = true;
    applicationPager.invalidate();
    agentPager.invalidate();
    setBusy(item?.id ?? "all");
    const chosen = item ? [item] : visibleItems.filter((value) => !value.readAt);
    try {
      const results = await Promise.allSettled(
        (["application", "agent"] as const).map(async (source) => {
          const ids = chosen.filter((value) => value.source === source).map((value) => value.id);
          if (!ids.length) return { source, ids: [] };
          const result = await markRead({ data: { source, ids } });
          if (
            !Array.isArray(result.ids) ||
            !result.ids.every((id) => typeof id === "string" && ids.includes(id))
          )
            throw new Error("Unconfirmed notification change");
          return { source, ids: result.ids };
        }),
      );
      if (activePrincipalRef.current !== expectedPrincipal) return;
      const now = new Date().toISOString();
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { source, ids } = result.value;
          setItems((current) =>
            current.map((value) =>
              value.source === source && ids.includes(value.id)
                ? { ...value, readAt: value.readAt ?? now }
                : value,
            ),
          );
        } else
          toast.error(
            "One notification source could not confirm the change. Refresh sources before retrying; confirmed changes are retained.",
          );
      }
    } finally {
      mutationPending.current = false;
      if (activePrincipalRef.current === expectedPrincipal) setBusy(null);
    }
  }
  async function discard(item: CenterNotification) {
    const expectedPrincipal = principalId;
    if (!expectedPrincipal || mutationPending.current) return;
    mutationPending.current = true;
    applicationPager.invalidate();
    agentPager.invalidate();
    setBusy(item.id);
    try {
      const result = await remove({ data: { ids: [item.id], source: item.source } });
      if (activePrincipalRef.current !== expectedPrincipal) return;
      if (!Array.isArray(result.ids) || !result.ids.every((id) => id === item.id))
        throw new Error("Unconfirmed notification deletion");
      setItems((current) =>
        current.filter((value) => value.source !== item.source || !result.ids.includes(value.id)),
      );
    } catch {
      if (activePrincipalRef.current === expectedPrincipal)
        toast.error(
          "Notification deletion could not be confirmed. Refresh sources before retrying.",
        );
    } finally {
      mutationPending.current = false;
      if (activePrincipalRef.current === expectedPrincipal) setBusy(null);
    }
  }
  return (
    <AppShell utilitiesInHeader>
      <main
        id="main-content"
        tabIndex={-1}
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
                {unread} unread notification{unread === 1 ? "" : "s"} on loaded pages
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
                Mark loaded pages read
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
        {principalId && (
          <section aria-label="Notification source pages">
            <CollectionPageControls
              label="Application notifications"
              pager={applicationPager}
              disabled={busy !== null}
            />
            <CollectionPageControls
              label="Agent notifications"
              pager={agentPager}
              disabled={busy !== null}
            />
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3"
              disabled={busy !== null || loading}
              onClick={() => {
                if (!mutationPending.current) void reload();
              }}
            >
              Refresh sources
            </button>
          </section>
        )}
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
            title={
              visibleItems.length ? "No matching notifications" : "No notifications on loaded pages"
            }
            description={
              visibleItems.length
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
                    {item.source === "agent" && (
                      <>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border px-3 text-sm"
                          disabled={detailLoading === item.id}
                          onClick={() => void revealDetails(item)}
                        >
                          {details?.owner === principalId && details.id === item.id
                            ? "Hide details"
                            : detailLoading === item.id
                              ? "Loading details…"
                              : "Show details"}
                        </button>
                        {details?.owner === principalId && details.id === item.id && (
                          <p className="mt-2 whitespace-pre-wrap text-sm">{details.body}</p>
                        )}
                      </>
                    )}
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
