import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { CONNECTOR_CATALOG, type ConnectorCategory } from "@/lib/connectors-catalog";
import { ArrowLeft, Link2 } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { toast } from "sonner";

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

function AppsPage() {
  const { isSignedIn } = useUser();

  const byCategory = CONNECTOR_CATALOG.reduce<Record<ConnectorCategory, typeof CONNECTOR_CATALOG>>(
    (acc, c) => {
      (acc[c.category] ||= []).push(c);
      return acc;
    },
    {} as Record<ConnectorCategory, typeof CONNECTOR_CATALOG>,
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        <div>
          <h2 className="text-xl font-semibold">Connect your apps</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Link external services so KovaGPT can reference your files, messages, and activity in
            chat. You can disconnect any app at any time.
          </p>
        </div>

        {(Object.keys(byCategory) as ConnectorCategory[]).map((cat) => (
          <section key={cat}>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
              {cat}
            </h3>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {byCategory[cat].map((item) => {
                const connectClassName = `text-xs px-2.5 py-1 rounded-full border transition shrink-0 ${
                  item.status === "live"
                    ? "border-foreground/20 hover:bg-accent"
                    : "border-border text-muted-foreground"
                }`;
                const label = item.status === "live" ? "Connect" : "Soon";
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-border bg-card p-3 flex items-start gap-3"
                  >
                    <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">
                      {item.label.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">
                        {item.description}
                      </div>
                    </div>
                    {item.status === "live" && !isSignedIn ? (
                      <SignInButton mode="modal">
                        <button className={connectClassName}>{label}</button>
                      </SignInButton>
                    ) : (
                      <button
                        onClick={() =>
                          item.status === "live"
                            ? toast.info(`${item.label} connection flow opens here.`)
                            : toast.message(`${item.label} is coming soon.`)
                        }
                        className={connectClassName}
                      >
                        {label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link to="/" className="p-2 rounded-md hover:bg-accent transition" aria-label="Back to chat">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <span className="inline-flex rounded-full dark:bg-black dark:p-[2px]">
          <NovaLogo className="w-6 h-6" />
        </span>
        <h1 className="font-display font-semibold tracking-tight text-base flex items-center gap-2">
          <Link2 className="w-4 h-4" /> Apps
        </h1>
      </div>
    </header>
  );
}
