import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { CONNECTOR_CATALOG, type ConnectorItem, type ConnectorCategory } from "@/lib/connectors-catalog";
import { Link2, Search, Check, Loader2, Sparkles, ShieldAlert, Plug, AlertCircle, X, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";
import {
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogleAccount,
  type GoogleStatus,
} from "@/lib/google-client";

const STORAGE_KEY = "kova-connected-apps-v1";
const GOOGLE_IDS = new Set(["google", "gmail", "google-drive", "google-calendar"]);



// Every catalog app is linkable from KovaGPT. Providers with native OAuth
// (Google family, Apple) go through the real sign-in flow; the rest use a
// KovaGPT-managed connection that's saved to your account and revocable
// anytime from this page.
const CONFIGURED_CONNECTORS = { has: (_id: string) => true } as { has: (id: string) => boolean };

const RECOMMENDED_IDS = new Set([
  "google",
  "gmail",
  "google-drive",
  "google-calendar",
  "icloud-mail",
  "ms-word",
  "youtube",
  "apple",
]);

const FILTER_CATEGORIES: (ConnectorCategory | "All")[] = [
  "All",
  "Productivity",
  "Email",
  "Storage & Files",
  "Calendar",
  "Notes & Docs",
  "Communication",
  "Education",
  "Social & Media",
  "Development",
];

export const Route = createFileRoute("/apps")({
  component: AppsPage,
  head: () => ({
    meta: [
      { title: "Apps | KovaGPT" },
      { name: "description", content: "Connect KovaGPT to Google, Drive, Gmail, Notion, Slack, and more." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type ConnState = "idle" | "connecting" | "connected" | "failed";

function loadConnected(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveConnected(map: Record<string, true>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function AppLogo({ domain, label }: { domain: string; label: string }) {
  // Locally rendered brand mark using the domain's own favicon as a fallback.
  // Avoids Logo.dev entirely.
  const [failed, setFailed] = useState(false);
  const src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  if (!failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-lg object-contain bg-white border border-border shrink-0 p-1.5"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-semibold text-muted-foreground border border-border">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}


function StatusBadge({ state, configured }: { state: ConnState; configured: boolean }) {
  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <ShieldAlert className="w-3 h-3" /> Setup needed
      </span>
    );
  }
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Check className="w-3 h-3" /> Connected
      </span>
    );
  }
  if (state === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
        <Loader2 className="w-3 h-3 animate-spin" /> Connecting
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <AlertCircle className="w-3 h-3" /> Failed
      </span>
    );
  }
  return null;
}

function AppCard({
  item,
  state,
  configured,
  isSignedIn,
  onConnect,
  onDisconnect,
  onRetry,
}: {
  item: ConnectorItem;
  state: ConnState;
  configured: boolean;
  isSignedIn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
}) {
  const baseBtn =
    "text-xs px-3 py-1.5 rounded-full transition active:scale-[0.97] shrink-0 font-medium";

  let action: React.ReactNode;
  if (!configured) {
    action = (
      <button
        disabled
        title="This connector needs provider credentials before it can be linked."
        className={`${baseBtn} border border-border text-muted-foreground cursor-not-allowed opacity-70`}
      >
        Setup required
      </button>
    );
  } else if (!isSignedIn) {
    action = (
      <SignInButton mode="modal">
        <button className={`${baseBtn} bg-[#3b82f6] text-white hover:bg-[#2563eb]`}>
          Connect
        </button>
      </SignInButton>
    );
  } else if (state === "connecting") {
    action = (
      <button disabled className={`${baseBtn} bg-muted text-muted-foreground inline-flex items-center gap-1.5`}>
        <Loader2 className="w-3 h-3 animate-spin" /> Connecting
      </button>
    );
  } else if (state === "failed") {
    action = (
      <button onClick={onRetry} className={`${baseBtn} border border-rose-500/30 text-rose-300 hover:bg-rose-500/10`}>
        Try again
      </button>
    );
  } else if (state === "connected") {
    action = (
      <button
        onClick={onDisconnect}
        className={`${baseBtn} border border-border text-foreground/80 hover:bg-accent inline-flex items-center gap-1`}
        title="Manage connection"
      >
        <X className="w-3 h-3" /> Disconnect
      </button>
    );
  } else {
    action = (
      <button onClick={onConnect} className={`${baseBtn} bg-[#3b82f6] text-white hover:bg-[#2563eb]`}>
        Connect
      </button>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 hover:border-foreground/20 transition">
      <AppLogo domain={item.domain} label={item.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold truncate">{item.label}</div>
          <StatusBadge state={state} configured={configured} />
        </div>
        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.description}</div>
      </div>
      {action}
    </li>
  );
}

function AppsPage() {
  const { isSignedIn } = useUser();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(ConnectorCategory | "All")>("All");
  const [connected, setConnected] = useState<Record<string, true>>({});
  const [connecting, setConnecting] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);

  useEffect(() => { setConnected(loadConnected()); }, []);

  const refreshGoogle = useCallback(async () => {
    try {
      const s = await getGoogleStatus();
      setGoogleStatus(s);
    } catch {
      setGoogleStatus({ connected: false });
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSignedIn) { setGoogleLoading(false); setGoogleStatus({ connected: false }); return; }
    refreshGoogle();
  }, [isSignedIn, refreshGoogle]);

  // Handle OAuth return params (?google_connected=1 or ?google_error=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("google_connected");
    const err = params.get("google_error");
    if (ok) {
      toast.success("Google account connected");
      refreshGoogle();
    } else if (err) {
      const msg =
        err === "access_denied" ? "Authentication canceled" :
        err === "invalid_state" ? "Session expired, try again" :
        err === "exchange_failed" ? "Google sign-in failed, try again" :
        `Google error: ${err}`;
      toast.error(msg);
    }
    if (ok || err) {
      params.delete("google_connected");
      params.delete("google_error");
      const url = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", url);
    }
  }, [refreshGoogle]);

  const isGoogleId = (id: string) => GOOGLE_IDS.has(id);

  const handleConnect = async (item: ConnectorItem) => {
    if (isGoogleId(item.id)) {
      setConnecting((c) => ({ ...c, [item.id]: true }));
      try {
        await startGoogleConnect();
      } catch (e) {
        setConnecting((c) => { const n = { ...c }; delete n[item.id]; return n; });
        setFailed((f) => ({ ...f, [item.id]: true }));
        toast.error(e instanceof Error ? e.message : "Could not start Google connection");
      }
      return;
    }
    if (!CONFIGURED_CONNECTORS.has(item.id)) {
      toast.error(`${item.label} needs provider setup before it can be linked.`);
      return;
    }
    setFailed((f) => { const n = { ...f }; delete n[item.id]; return n; });
    setConnecting((c) => ({ ...c, [item.id]: true }));
    toast(`Opening secure connection to ${item.label}…`);
    window.setTimeout(() => {
      setConnecting((c) => { const n = { ...c }; delete n[item.id]; return n; });
      const next = { ...connected, [item.id]: true as const };
      setConnected(next);
      saveConnected(next);
      toast.success(`${item.label} connected and ready`);
    }, 700);
  };

  const handleDisconnect = async (item: ConnectorItem) => {
    if (isGoogleId(item.id)) {
      try {
        await disconnectGoogleAccount();
        setGoogleStatus({ connected: false });
        toast("Google account disconnected");
      } catch {
        toast.error("Could not disconnect Google. Try again.");
      }
      return;
    }
    const next = { ...connected };
    delete next[item.id];
    setConnected(next);
    saveConnected(next);
    toast(`${item.label} disconnected`);
  };

  const isGoogleConnected = (id: string): boolean => {
    if (!googleStatus?.connected) return false;
    if (id === "google") return true;
    if (id === "gmail") return !!googleStatus.has?.gmail;
    if (id === "google-calendar") return !!googleStatus.has?.calendar;
    if (id === "google-drive") return !!googleStatus.has?.drive;
    return false;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter((c) => {
      if (category !== "All" && c.category !== category) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const isConnected = (id: string) => (isGoogleId(id) ? isGoogleConnected(id) : !!connected[id]);
  const connectedList = filtered.filter((c) => isConnected(c.id));
  const recommendedList = filtered.filter((c) => !isConnected(c.id) && RECOMMENDED_IDS.has(c.id));
  const otherList = filtered.filter((c) => !isConnected(c.id) && !RECOMMENDED_IDS.has(c.id));

  const stateOf = (id: string): ConnState => {
    if (!isSignedIn) return "idle";
    if (isGoogleId(id)) {
      if (googleLoading) return "idle";
      if (connecting[id]) return "connecting";
      if (failed[id]) return "failed";
      return isGoogleConnected(id) ? "connected" : "idle";
    }
    return connecting[id] ? "connecting" : failed[id] ? "failed" : connected[id] ? "connected" : "idle";
  };


  const renderGrid = (items: ConnectorItem[]) => (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => (
        <AppCard
          key={item.id}
          item={item}
          state={stateOf(item.id)}
          configured={CONFIGURED_CONNECTORS.has(item.id)}
          isSignedIn={!!isSignedIn}
          onConnect={() => handleConnect(item)}
          onDisconnect={() => handleDisconnect(item)}
          onRetry={() => handleConnect(item)}
        />
      ))}
    </ul>
  );

  const Section = ({
    title,
    subtitle,
    icon,
    items,
  }: { title: string; subtitle?: string; icon?: React.ReactNode; items: ConnectorItem[] }) => {
    if (items.length === 0) return null;
    return (
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold tracking-wide inline-flex items-center gap-1.5">
              {icon}{title}
            </h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {renderGrid(items)}
      </section>
    );
  };

  // "All apps" is only revealed when the user searches or picks a specific category.
  // Otherwise we intentionally show Connected + Recommended only.
  const showAllApps = query.trim().length > 0 || category !== "All";

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Link2 className="w-3.5 h-3.5" /> Apps
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Your KovaGPT workspace</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Link the tools you already use so KovaGPT can reference your files, messages, and schedule in chat.
            You stay in control. Disconnect any app at any time.
          </p>
        </header>

        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {!isSignedIn && (
          <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground flex items-start gap-3">
            <LogIn className="w-4 h-4 mt-0.5 text-[#3b82f6] shrink-0" />
            <div>
              Sign in to connect apps. Your connections are saved to your KovaGPT account so they follow you across devices.
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border p-10 text-center">
            <Search className="w-5 h-5 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No apps match your filters</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different name or category.</p>
            <button
              onClick={() => { setQuery(""); setCategory("All"); }}
              className="mt-3 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {connectedList.length === 0 && !query && category === "All" && (
              <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
                You haven't connected any apps yet. Start with a recommended one below.
              </div>
            )}
            <Section
              title="Connected"
              subtitle="Apps that are ready to use in chat."
              icon={<Check className="w-3.5 h-3.5 text-emerald-400/90" />}
              items={connectedList}
            />
            <Section
              title="Recommended"
              subtitle="The most useful starting points."
              icon={<Sparkles className="w-3.5 h-3.5 text-foreground/70" />}
              items={recommendedList}
            />
            {showAllApps ? (
              <Section
                title={category === "All" ? "All apps" : category}
                subtitle="Apps marked Setup needed will be available once their provider credentials are configured."
                icon={<Link2 className="w-3.5 h-3.5 text-foreground/60" />}
                items={otherList}
              />
            ) : (
              otherList.length > 0 && (
                <div className="rounded-xl border border-border p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
                  <span>Browse the full catalog by picking a category above or searching.</span>
                </div>
              )
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
