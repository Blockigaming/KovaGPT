import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "KovaGPT Service Status" },
      {
        name: "description",
        content:
          "Check KovaGPT's application health endpoint and find recovery guidance if the service is not loading.",
      },
      { property: "og:title", content: "KovaGPT Service Status" },
      { property: "og:url", content: "https://kovagpt.com/status" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/status" }],
  }),
  component: () => (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="mb-3 text-4xl font-bold tracking-tight">KovaGPT Service Status</h1>
        <p className="mb-8 text-muted-foreground">
          This page is not connected to automated incident monitoring and does not claim that all
          systems are operational.
        </p>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Check application health</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The health endpoint confirms whether the application server can respond. It does not
            guarantee that every external provider or account-specific feature is available.
          </p>
          <a
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
            href="/api/health"
          >
            Open health endpoint
          </a>
        </section>
        <p className="mt-8 text-sm text-muted-foreground">
          If KovaGPT is not loading, retry once and then{" "}
          <Link to="/contact-support" className="underline hover:text-foreground">
            contact support
          </Link>{" "}
          with the page URL, time, and action you were attempting.
        </p>
      </main>
    </PublicShell>
  ),
});
