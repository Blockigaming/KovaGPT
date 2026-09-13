import { hasGoogleCapability } from "@/lib/google-account-policy.mjs";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import {
  Plus,
  ImageIcon,
  FolderKanban,
  Calendar,
  Mail,
  ListChecks,
  CloudSun,
  X,
  RotateCcw,
  FolderOpen,
  Link2,
  MessageCircle,
  Sparkles,
  Clock,
  CheckCircle2,
  Pin,
  ArrowRight,
} from "lucide-react";
import {
  chatStoragePrincipal,
  loadConversations,
  savePendingActive,
  type Conversation,
} from "@/lib/chat-store";
import { safeNavigationUrl } from "@/lib/safe-url";
import {
  getSummaryProjects,
  getSummaryImages,
  getSummaryFiles,
  getSummaryTasks,
  getGoogleStatus,
  getGmailSummary,
  getCalendarSummary,
} from "@/lib/summary.functions";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import { authFetch } from "@/lib/auth-fetch";

export const Route = createFileRoute("/summary")({
  head: () => ({
    meta: [
      { title: "KovaGPT Summary" },
      {
        name: "description",
        content:
          "Your personalized KovaGPT dashboard: chats, projects, files, tasks, and connected apps at a glance.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SummaryPage,
});

const EMPTY_CONVERSATIONS: Conversation[] = [];

// -------- Dismissible sections --------
const DISMISS_KEY_BASE = "kova-summary-dismissed";
type SectionId =
  | "continue"
  | "pinned"
  | "projects"
  | "images"
  | "files"
  | "calendar"
  | "gmail"
  | "tasks"
  | "suggested"
  | "quick"
  | "apps"
  | "library"
  | "weather";

function loadDismissed(key: string | null): SectionId[] {
  if (!key) return [];
  try {
    return JSON.parse(safeBrowserStorage("localStorage")?.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
function saveDismissed(key: string | null, v: SectionId[]) {
  if (!key) return;
  try {
    safeBrowserStorage("localStorage")?.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

// -------- Greeting --------
function useGreeting(name: string | null) {
  return useMemo(() => {
    const h = new Date().getHours();
    const part =
      h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return name ? `${part}, ${name}` : part;
  }, [name]);
}

// -------- Weather via geolocation + open-meteo (no key) --------
type Weather = { temp: number; code: number; label: string; city: string | null };
const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  61: "Rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
};
function useWeather(enabled: boolean, scope: string | null) {
  const [state, setState] = useState<{
    status: "idle" | "loading" | "ok" | "denied" | "error";
    data: Weather | null;
  }>({ status: "idle", data: null });
  useEffect(() => {
    let current = true;
    if (!enabled || typeof window === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "idle", data: null });
      return () => {
        current = false;
      };
    }
    setState({ status: "loading", data: null });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          const r = await authFetch("/api/weather", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude: lat, longitude: lon }),
          });
          if (!r.ok) throw new Error("weather");
          const j = (await r.json()) as { temperature?: unknown; code?: unknown };
          if (!current) return;
          const code = typeof j.code === "number" ? j.code : 0;
          setState({
            status: "ok",
            data: {
              temp: typeof j.temperature === "number" ? j.temperature : 0,
              code,
              label: WMO[code] ?? "-",
              city: null,
            },
          });
        } catch {
          if (current) setState({ status: "error", data: null });
        }
      },
      () => {
        if (current) setState({ status: "denied", data: null });
      },
      { timeout: 6000, maximumAge: 15 * 60_000 },
    );
    return () => {
      current = false;
    };
  }, [enabled, scope]);
  return state;
}

// -------- Section wrapper --------
function Section({
  id,
  title,
  icon: Icon,
  action,
  onDismiss,
  children,
}: {
  id: SectionId;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  onDismiss: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-medium flex-1">{title}</h2>
        {action}
        <button
          onClick={() => onDismiss(id)}
          className="p-1 rounded hover:bg-accent text-muted-foreground"
          aria-label={`Hide ${title}`}
          title="Hide section"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/60 ${className}`} />;
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SummaryPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const dismissKey = isLoaded ? principalScopedStorageKey(DISMISS_KEY_BASE, userKey) : null;
  const weatherKey = isLoaded ? principalScopedStorageKey("kova-weather-opt-in", userKey) : null;
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !isSignedIn) navigate({ to: "/" });
  }, [isLoaded, isSignedIn, navigate]);

  const [dismissed, setDismissed] = useState<SectionId[]>([]);
  const [preferencesPrincipal, setPreferencesPrincipal] = useState<string | null>(null);
  const preferencesReady = principal !== null && preferencesPrincipal === principal;
  const visibleDismissed = preferencesReady ? dismissed : [];
  const isHidden = (id: SectionId) => visibleDismissed.includes(id);
  const hide = (id: SectionId) => {
    if (!preferencesReady) return;
    const next = Array.from(new Set([...visibleDismissed, id]));
    setDismissed(next);
    saveDismissed(dismissKey, next);
  };
  const restore = () => {
    if (!preferencesReady) return;
    setDismissed([]);
    saveDismissed(dismissKey, []);
  };

  const firstName = (user?.firstName ?? user?.fullName?.split(" ")[0] ?? null) as string | null;
  const greeting = useGreeting(firstName);

  // Local chats
  const [conversationState, setConversationState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const conversations =
    principal !== null && conversationState.principal === principal
      ? conversationState.items
      : EMPTY_CONVERSATIONS;
  useEffect(() => {
    if (!isLoaded || !isSignedIn || principal === null) {
      setConversationState({ principal: null, items: [] });
      return;
    }
    setConversationState({ principal, items: loadConversations(userKey) });
  }, [isLoaded, isSignedIn, principal, userKey]);
  const pinned = conversations.filter((c) => c.pinned).slice(0, 4);
  const continueChats = conversations
    .filter((c) => !c.pinned)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 4);

  // Server data (independent queries)
  const enabled = isLoaded && !!isSignedIn && !!userKey;
  const qProjects = useQuery({
    queryKey: ["summary", "projects", userKey],
    queryFn: () => getSummaryProjects(),
    enabled,
    staleTime: 30_000,
  });
  const qImages = useQuery({
    queryKey: ["summary", "images", userKey],
    queryFn: () => getSummaryImages(),
    enabled,
    staleTime: 30_000,
  });
  const qFiles = useQuery({
    queryKey: ["summary", "files", userKey],
    queryFn: () => getSummaryFiles(),
    enabled,
    staleTime: 30_000,
  });
  const qTasks = useQuery({
    queryKey: ["summary", "tasks", userKey],
    queryFn: () => getSummaryTasks(),
    enabled,
    staleTime: 30_000,
  });
  const qGoogle = useQuery({
    queryKey: ["summary", "google", userKey],
    queryFn: () => getGoogleStatus({ data: { expectedUserId: userKey! } }),
    enabled,
    staleTime: 0,
  });

  const hasGmail =
    !qGoogle.isFetching &&
    !!qGoogle.data?.connected &&
    !!qGoogle.data.connectionId &&
    hasGoogleCapability(qGoogle.data.scopes, "gmail.read");
  const hasCal =
    !qGoogle.isFetching &&
    !!qGoogle.data?.connected &&
    !!qGoogle.data.connectionId &&
    hasGoogleCapability(qGoogle.data.scopes, "calendar.read");

  const qGmail = useQuery({
    queryKey: ["summary", "gmail", userKey, qGoogle.data?.connectionId],
    queryFn: () => getGmailSummary({ data: { connectionId: qGoogle.data!.connectionId! } }),
    enabled: enabled && hasGmail,
    staleTime: 60_000,
  });
  const qCal = useQuery({
    queryKey: ["summary", "cal", userKey, qGoogle.data?.connectionId],
    queryFn: () => getCalendarSummary({ data: { connectionId: qGoogle.data!.connectionId! } }),
    enabled: enabled && hasCal,
    staleTime: 60_000,
  });

  // Weather (opt-in via localStorage flag; user grants location permission on button click)
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const visibleWeatherEnabled = preferencesReady ? weatherEnabled : false;
  const weather = useWeather(visibleWeatherEnabled, principal);
  const enableWeather = () => {
    if (!preferencesReady || !weatherKey) return;
    setWeatherEnabled(true);
    safeBrowserStorage("localStorage")?.setItem(weatherKey, "1");
  };

  useEffect(() => {
    if (!principal || !dismissKey || !weatherKey) {
      setDismissed([]);
      setWeatherEnabled(false);
      setPreferencesPrincipal(null);
      return;
    }
    setDismissed(loadDismissed(dismissKey));
    setWeatherEnabled(safeBrowserStorage("localStorage")?.getItem(weatherKey) === "1");
    setPreferencesPrincipal(principal);
  }, [dismissKey, principal, weatherKey]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      setDismissed([]);
      setWeatherEnabled(false);
      setPreferencesPrincipal(principal);
      setConversationState({ principal, items: [] });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  // Suggested actions - derived from real state
  const suggestions: Array<{ label: string; to: string; hint: string }> = [];
  if (!qGoogle.data?.connected)
    suggestions.push({
      label: "Connect Google",
      to: "/apps",
      hint: "Get Gmail, Calendar, and Drive summaries.",
    });
  if ((qProjects.data ?? []).length === 0)
    suggestions.push({
      label: "Create your first project",
      to: "/projects",
      hint: "Group chats, files, and tasks.",
    });
  if (pinned.length === 0 && conversations.length > 0)
    suggestions.push({
      label: "Pin your most-used chat",
      to: "/",
      hint: "Keep it at the top of the sidebar.",
    });
  if ((qImages.data ?? []).length === 0)
    suggestions.push({
      label: "Generate your first image",
      to: "/images",
      hint: "Describe it and pick a style.",
    });

  if (!isLoaded || !isSignedIn) {
    return (
      <AppShell>
        <div className="p-6">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        {/* Greeting + composer */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{greeting}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Here's what's happening in your workspace.
          </p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-5 w-full flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-left text-muted-foreground hover:bg-accent/40 hover:border-foreground/20 transition shadow-sm"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-[15px]">Ask KovaGPT anything…</span>
            <ArrowRight className="w-4 h-4 ml-auto" />
          </button>
        </div>

        <div className="grid gap-4 sm:gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {!isHidden("quick") && (
            <Section id="quick" title="Quick actions" icon={Sparkles} onDismiss={hide}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "New chat", icon: Plus, to: "/" },
                  { label: "New image", icon: ImageIcon, to: "/images" },
                  { label: "New project", icon: FolderKanban, to: "/projects" },
                  { label: "Library", icon: FolderOpen, to: "/library" },
                  { label: "Scheduled", icon: Clock, to: "/scheduled-tasks" },
                ].map((a) => (
                  <Link
                    key={a.label}
                    to={a.to}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40 transition"
                  >
                    <a.icon className="w-4 h-4 text-muted-foreground" />
                    <span className="truncate">{a.label}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {!isHidden("continue") && (
            <Section
              id="continue"
              title="Continue where you left off"
              icon={MessageCircle}
              onDismiss={hide}
            >
              {continueChats.length === 0 ? (
                <Empty text="No recent chats yet - start one from the composer above." />
              ) : (
                <ul className="space-y-1">
                  {continueChats.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          try {
                            savePendingActive(userKey, c.id);
                          } catch {
                            /* ignore */
                          }
                          navigate({ to: "/" });
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-left hover:bg-accent/40"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{c.title || "Untitled"}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(new Date(c.updatedAt).toISOString())}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("pinned") && pinned.length > 0 && (
            <Section id="pinned" title="Pinned chats" icon={Pin} onDismiss={hide}>
              <ul className="space-y-1">
                {pinned.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        try {
                          savePendingActive(userKey, c.id);
                        } catch {
                          /* ignore */
                        }
                        navigate({ to: "/" });
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-left hover:bg-accent/40"
                    >
                      <Pin className="w-3.5 h-3.5 text-muted-foreground shrink-0 fill-current" />
                      <span className="truncate">{c.title || "Untitled"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!isHidden("projects") && (
            <Section
              id="projects"
              title="Recent projects"
              icon={FolderKanban}
              onDismiss={hide}
              action={
                <Link
                  to="/projects"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  All
                </Link>
              }
            >
              {qProjects.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : (qProjects.data ?? []).length === 0 ? (
                <Empty text="No projects yet." />
              ) : (
                <ul className="space-y-1">
                  {(qProjects.data ?? []).slice(0, 5).map((p) => (
                    <li key={p.id}>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent/40"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: p.color ?? "hsl(var(--muted-foreground))" }}
                        />
                        <span className="truncate flex-1">{p.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(p.updated_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("images") && (
            <Section
              id="images"
              title="Recent images"
              icon={ImageIcon}
              onDismiss={hide}
              action={
                <Link to="/images" className="text-xs text-muted-foreground hover:text-foreground">
                  All
                </Link>
              }
            >
              {qImages.isLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square" />
                  ))}
                </div>
              ) : (qImages.data ?? []).length === 0 ? (
                <Empty text="No images yet." />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(qImages.data ?? []).slice(0, 6).map((img) => (
                    <Link
                      key={img.id}
                      to="/library"
                      className="block aspect-square rounded-lg overflow-hidden border border-border bg-muted/40"
                    >
                      {img.file_url ? (
                        <img
                          src={img.file_url}
                          alt={img.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="w-4 h-4" />
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          )}

          {!isHidden("files") && (
            <Section
              id="files"
              title="Recent files"
              icon={FolderOpen}
              onDismiss={hide}
              action={
                <Link to="/library" className="text-xs text-muted-foreground hover:text-foreground">
                  All
                </Link>
              }
            >
              {qFiles.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : (qFiles.data ?? []).length === 0 ? (
                <Empty text="No files yet." />
              ) : (
                <ul className="space-y-1">
                  {(qFiles.data ?? []).slice(0, 5).map((f) => (
                    <li key={f.id}>
                      {safeNavigationUrl(f.file_url) ? (
                        <a
                          href={safeNavigationUrl(f.file_url)!}
                          target="_blank"
                          rel="noopener"
                          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent/40"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{f.title}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(f.created_at)}
                          </span>
                        </a>
                      ) : (
                        <Link
                          to="/library"
                          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent/40"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{f.title}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(f.created_at)}
                          </span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("tasks") && (
            <Section id="tasks" title="Tasks" icon={ListChecks} onDismiss={hide}>
              {qTasks.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : (qTasks.data ?? []).length === 0 ? (
                <Empty text="Nothing on your list." />
              ) : (
                <ul className="space-y-1">
                  {(qTasks.data ?? []).map((t) => (
                    <li
                      key={`${t.source}-${t.id}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{t.title}</span>
                      {t.due_at && (
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(t.due_at)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("calendar") && (
            <Section id="calendar" title="Calendar" icon={Calendar} onDismiss={hide}>
              {hasCal && (
                <p className="mb-2 text-xs text-muted-foreground">{qGoogle.data?.email}</p>
              )}
              {!qGoogle.isFetching && !hasCal ? (
                <div className="text-sm text-muted-foreground">
                  <p className="mb-2">Connect Google Calendar to see upcoming events.</p>
                  <Link to="/apps" className="text-xs underline">
                    Connect →
                  </Link>
                </div>
              ) : qCal.isLoading || qGoogle.isFetching ? (
                <div className="space-y-2">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : !qCal.data?.available ? (
                <Empty text="Calendar unavailable right now." />
              ) : qCal.data.events.length === 0 ? (
                <Empty text="Nothing scheduled in the next 7 days." />
              ) : (
                <ul className="space-y-1">
                  {qCal.data.events.map((e) => (
                    <li key={e.id}>
                      {e.link ? (
                        <a
                          href={e.link}
                          target="_blank"
                          rel="noopener"
                          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent/40"
                        >
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{e.title}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(e.start)}
                          </span>
                        </a>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{e.title}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(e.start)}
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("gmail") && (
            <Section id="gmail" title="Gmail - unread" icon={Mail} onDismiss={hide}>
              {hasGmail && (
                <p className="mb-2 text-xs text-muted-foreground">{qGoogle.data?.email}</p>
              )}
              {!qGoogle.isFetching && !hasGmail ? (
                <div className="text-sm text-muted-foreground">
                  <p className="mb-2">Connect Gmail to see unread messages.</p>
                  <Link to="/apps" className="text-xs underline">
                    Connect →
                  </Link>
                </div>
              ) : qGmail.isLoading || qGoogle.isFetching ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : !qGmail.data?.available ? (
                <Empty text="Gmail unavailable right now." />
              ) : qGmail.data.messages.length === 0 ? (
                <Empty text="Inbox zero. Nice." />
              ) : (
                <ul className="space-y-2">
                  {qGmail.data.messages.map((m) => (
                    <li key={m.id}>
                      <a
                        href={`https://mail.google.com/mail/u/0/#inbox/${m.id}`}
                        target="_blank"
                        rel="noopener"
                        className="block rounded-lg px-2 py-2 text-sm hover:bg-accent/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate flex-1 font-medium">{m.subject}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {fmtDate(m.date)}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{m.from}</div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!isHidden("suggested") && suggestions.length > 0 && (
            <Section id="suggested" title="Suggested actions" icon={Sparkles} onDismiss={hide}>
              <ul className="space-y-2">
                {suggestions.slice(0, 4).map((s) => (
                  <li key={s.label}>
                    <Link
                      to={s.to}
                      className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-accent/40 transition"
                    >
                      <ArrowRight className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{s.hint}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!isHidden("apps") && (
            <Section
              id="apps"
              title="Apps"
              icon={Link2}
              onDismiss={hide}
              action={
                <Link to="/apps" className="text-xs text-muted-foreground hover:text-foreground">
                  Manage
                </Link>
              }
            >
              <p className="text-sm text-muted-foreground mb-3">
                {qGoogle.data?.connected
                  ? `Google connected${qGoogle.data.email ? ` as ${qGoogle.data.email}` : ""}.`
                  : "Connect Google, Notion, Slack, and more."}
              </p>
              <Link to="/apps" className="inline-flex items-center gap-1.5 text-sm underline">
                Open Apps <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Section>
          )}

          {!isHidden("library") && (
            <Section
              id="library"
              title="Library"
              icon={FolderOpen}
              onDismiss={hide}
              action={
                <Link to="/library" className="text-xs text-muted-foreground hover:text-foreground">
                  Open
                </Link>
              }
            >
              <p className="text-sm text-muted-foreground">
                Saved chats, files, and generated images live here.
              </p>
            </Section>
          )}

          {!isHidden("weather") && (
            <Section id="weather" title="Weather" icon={CloudSun} onDismiss={hide}>
              {!visibleWeatherEnabled ? (
                <div className="text-sm text-muted-foreground">
                  <p className="mb-2">
                    Show local weather using your device location. Nothing is stored.
                  </p>
                  <button onClick={enableWeather} className="text-xs underline">
                    Enable
                  </button>
                </div>
              ) : weather.status === "loading" || weather.status === "idle" ? (
                <Skeleton className="h-8 w-32" />
              ) : weather.status === "denied" ? (
                <Empty text="Location permission denied." />
              ) : weather.status === "error" || !weather.data ? (
                <Empty text="Weather unavailable right now." />
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold">{weather.data.temp}°</span>
                  <span className="text-sm text-muted-foreground">{weather.data.label}</span>
                </div>
              )}
            </Section>
          )}
        </div>

        {visibleDismissed.length > 0 && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={restore}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore {visibleDismissed.length} hidden section
              {visibleDismissed.length === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
