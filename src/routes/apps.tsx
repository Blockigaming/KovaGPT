import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { CONNECTOR_CATALOG, type ConnectorCategory } from "@/lib/connectors-catalog";
import { Link2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";

const LOGO_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_LOGO_DEV_API_KEY as string | undefined;

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

function AppLogo({ domain, label }: { domain: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (LOGO_KEY && !failed) {
    return (
      <img
        src={`https://img.logo.dev/${domain}?token=${LOGO_KEY}&size=64`}
        alt={`${label} logo`}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-9 h-9 rounded-md object-contain bg-white border border-border shrink-0"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function AppsPage() {
  const { isSignedIn } = useUser();
  const [query, setQuery] = useState("");

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

  const byCategory = filtered.reduce<Record<ConnectorCategory, typeof CONNECTOR_CATALOG>>(
    (acc, c) => {
      (acc[c.category] ||= []).push(c);
      return acc;
    },
    {} as Record<ConnectorCategory, typeof CONNECTOR_CATALOG>,
  );

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto w-full px-4 py-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Link2 className="w-5 h-5" /> Connect your apps
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Link external services so KovaGPT can reference your files, messages, and activity in
            chat. You can disconnect any app at any time.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps (Gmail, Notion, Slack, ...)"
            className="h-10 pl-9"
          />
        </div>

        {(Object.keys(byCategory) as ConnectorCategory[]).map((cat) => (
          <section key={cat}>
            <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
              {cat}
            </h2>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {byCategory[cat].map((item) => {
                const btnCls =
                  "text-xs px-2.5 py-1 rounded-full border border-foreground/20 hover:bg-accent transition shrink-0 active:scale-[0.97]";
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-border bg-card p-3 flex items-start gap-3"
                  >
                    <AppLogo domain={item.domain} label={item.label} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">
                        {item.description}
                      </div>
                    </div>
                    {!isSignedIn ? (
                      <SignInButton mode="modal">
                        <button className={btnCls}>Connect</button>
                      </SignInButton>
                    ) : (
                      <button
                        onClick={() => toast.info(`${item.label} connection flow opens here.`)}
                        className={btnCls}
                      >
                        Connect
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No apps match "{query}".
          </div>
        )}
      </main>
    </AppShell>
  );
}
