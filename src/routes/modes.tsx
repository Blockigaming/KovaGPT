import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

export const Route = createFileRoute("/modes")({
  head: () => ({
    meta: [
      { title: "KovaGPT AI Modes" },
      {
        name: "description",
        content: "Compare the KovaGPT modes currently available on Free, Plus, and Pro plans.",
      },
      { property: "og:title", content: "KovaGPT AI Modes" },
      {
        property: "og:description",
        content: "Learn what each KovaGPT mode is best for.",
      },
      { property: "og:url", content: "https://kovagpt.com/modes" },
      { property: "og:image", content: "https://kovagpt.com/og/modes.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT AI Modes" },
      {
        name: "twitter:description",
        content: "Learn what each KovaGPT mode is best for.",
      },
      { name: "twitter:image", content: "https://kovagpt.com/og/modes.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/modes" }],
  }),
  component: ModesPage,
});

function ModesPage() {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-3">KovaGPT AI Modes</h1>
        <p className="text-muted-foreground mb-10">
          Choose how much speed and reasoning you want. Mode access follows your current plan;
          provider availability can still affect a response.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {CAPABILITY_REGISTRY.modes.map((mode) => (
            <div key={mode.id} className="rounded-xl border border-border p-4 bg-card">
              <h2 className="font-semibold mb-1">{mode.label}</h2>
              <p className="text-sm text-muted-foreground">{mode.description}</p>
              <p className="text-xs text-muted-foreground mt-2">
                <span className="font-medium text-foreground">Minimum plan:</span>{" "}
                {CAPABILITY_REGISTRY.plans[mode.minimumTier].name}
              </p>
            </div>
          ))}
        </div>
        <section className="mt-10 rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Modes by plan</h2>
          <dl className="mt-3 space-y-3 text-sm">
            {(["free", "plus", "pro"] as const).map((tier) => (
              <div key={tier}>
                <dt className="font-medium">{CAPABILITY_REGISTRY.plans[tier].name}</dt>
                <dd className="text-muted-foreground">
                  {CAPABILITY_REGISTRY.modesByTier[tier].map((mode) => mode.label).join(", ")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="mt-10 text-sm">
          <Link to="/pricing" className="underline hover:text-foreground">
            See which modes are included in each plan →
          </Link>
        </p>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/study-assistant" className="underline hover:text-foreground">
            Study Assistant
          </Link>
          <Link to="/code-helper" className="underline hover:text-foreground">
            Code Helper
          </Link>
          <Link to="/ai-writer" className="underline hover:text-foreground">
            AI Writer
          </Link>
          <Link to="/research-assistant" className="underline hover:text-foreground">
            Research Assistant
          </Link>
        </div>
      </main>
    </PublicShell>
  );
}
