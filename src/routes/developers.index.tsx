import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPageView } from "@/components/public/PublicSite";

export const Route = createFileRoute("/developers/")({
  component: DevelopersOverview,
  head: () => ({
    meta: [
      { title: "Developer Platform Availability | KovaGPT" },
      {
        name: "description",
        content: "Current availability of developer APIs and integration tools for KovaGPT.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/developers" }],
  }),
});

function DevelopersOverview() {
  return (
    <PublicPageView
      eyebrow="Developers"
      title="A public developer platform is not available yet"
      summary="KovaGPT does not currently issue public API keys or provide a supported, versioned API or SDK."
    >
      <article className="rounded-2xl border border-border bg-background p-6">
        <h2 className="text-xl font-semibold">Current status</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Internal application routes are implementation details, not a public integration contract.
          Do not build production integrations against them.
        </p>
      </article>
      <article className="rounded-2xl border border-border bg-background p-6">
        <h2 className="text-xl font-semibold">Questions about integrations?</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Contact support to discuss the current product and available app connections.
        </p>
        <Link to="/contact-support" className="mt-4 inline-flex min-h-11 items-center underline">
          Contact support
        </Link>
      </article>
    </PublicPageView>
  );
}
