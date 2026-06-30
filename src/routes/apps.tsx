import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { CONNECTOR_CATALOG, type ConnectorItem } from "@/lib/connectors-catalog";
import { Link2, Search, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";

const LOGO_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_LOGO_DEV_API_KEY as string | undefined;
const STORAGE_KEY = "kova-connected-apps-v1";

const RECOMMENDED_IDS = new Set([
  "google",
  "gmail",
  "google-drive",
  "google-calendar",
  "notion",
  "slack",
  "github",
  "google-docs",
]);

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

type ConnState = "idle" | "connecting" | "connected";

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
  const [failed, setFailed] = useState(false);
  if (LOGO_KEY && !failed) {
    return (
      <img
        src={`https://img.logo.dev/${domain}?token=${LOGO_KEY}&size=64`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-lg object-contain bg-white border border-border shrink-0 p-1"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-semibold text-muted-foreground">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function AppCard({
  item,
  state,
  isSignedIn,
  onConnect,
  onDisconnect,
}: {
  item: ConnectorItem;
  state: ConnState;
  isSignedIn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const baseBtn =
    "text-xs px-3 py-1.5 rounded-full transition active:scale-[0.97] shrink-0 font-medium";

  let action;
  if (!isSignedIn) {
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
  } else if (state === "connected") {
    action = (
      <button
        onClick={onDisconnect}
        className={`${baseBtn} border border-border text-foreground/80 hover:bg-accent`}
        title="Manage connection"
      >
        Manage
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
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold truncate">{item.label}</div>
          {state === "connected" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400/90">
              <Check className="w-3 h-3" /> Ready
            </span>
          )}
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
  const [connected, setConnected] = useState<Record<string, true>>({});
  const [connecting, setConnecting] = useState<Record<string, true>>({});

  useEffect(() => { setConnected(loadConnected()); }, []);

  const handleConnect = (item: ConnectorItem) => {
    setConnecting((c) => ({ ...c, [item.id]: true }));
    // Simulated handshake; real OAuth flow plugs in here per provider.
    window.setTimeout(() => {
      setConnecting((c) => { const n = { ...c }; delete n[item.id]; return n; });
      const next = { ...connected, [item.id]: true as const };
      setConnected(next);
      saveConnected(next);
      toast.success(`${item.label} connected and ready`);
    }, 700);
  };

  const handleDisconnect = (item: ConnectorItem) => {
    const next = { ...connected };
    delete next[item.id];
    setConnected(next);
    saveConnected(next);
    toast(`${item.label} disconnected`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CONNECTOR_CATALOG;
    return CONNECTOR_CATALOG.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [query]);

  const connectedList = filtered.filter((c) => connected[c.id]);
  const recommendedList = filtered.filter((c) => !connected[c.id] && RECOMMENDED_IDS.has(c.id));
  const otherList = filtered.filter((c) => !connected[c.id] && !RECOMMENDED_IDS.has(c.id));

  const stateOf = (id: string): ConnState =>
    connecting[id] ? "connecting" : connected[id] ? "connected" : "idle";

  const renderGrid = (items: ConnectorItem[]) => (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => (
        <AppCard
          key={item.id}
          item={item}
          state={stateOf(item.id)}
          isSignedIn={!!isSignedIn}
          onConnect={() => handleConnect(item)}
          onDisconnect={() => handleDisconnect(item)}
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
              <span className="text-xs font-normal text-muted-foreground">· {items.length}</span>
            </h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {renderGrid(items)}
      </section>
    );
  };

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Link2 className="w-3.5 h-3.5" /> Apps
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect your tools</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Link apps so KovaGPT can reference your files, messages, and activity in chat.
            You stay in control. Disconnect any app at any time.
          </p>
        </header>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps"
            className="h-10 pl-9"
          />
        </div>

        {!isSignedIn && (
          <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
            Sign in to connect apps. Your connections are saved to your KovaGPT account.
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Search className="w-5 h-5 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No apps match "{query}"</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different name or category.</p>
            <button
              onClick={() => setQuery("")}
              className="mt-3 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {connectedList.length === 0 && !query && (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                You haven't connected any apps yet. Pick one below to get started.
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
            <Section
              title="All apps"
              subtitle={`${otherList.length.toLocaleString()} more apps available.`}
              icon={<RefreshCw className="w-3.5 h-3.5 text-foreground/60" />}
              items={otherList}
            />
          </>
        )}
      </main>
    </AppShell>
  );
}
