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
      title="Build with KovaGPT"
      summary="Prepare scoped API keys, spending limits, and integrations in the developer console. Paid execution requires an enabled, funded account and current pricing."
    >
      <article className="rounded-2xl border border-border bg-background p-6">
        <h2 className="text-xl font-semibold">Current status</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          The versioned source contracts cover quoted generation, retrieval, resource management and
          durable background jobs. Availability depends on the console, approved model catalog and
          runtime gates. No official SDK is published yet.
        </p>
        <Link to="/developers/console" className="mt-4 inline-flex min-h-11 items-center underline">
          Open developer console
        </Link>
        <Link
          to="/developers/$docSlug"
          params={{ docSlug: "quickstart" }}
          className="ml-5 mt-4 inline-flex min-h-11 items-center underline"
        >
          Read the quickstart
        </Link>
      </article>
      <article className="rounded-2xl border border-border bg-background p-6">
        <h2 className="text-xl font-semibold">Explore the developer documentation</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Search endpoint request contracts, lifecycle guides, SDK instructions and troubleshooting.
          Preview documentation does not imply a production launch.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link
            to="/developers/$docSlug"
            params={{ docSlug: "docs" }}
            className="inline-flex min-h-11 items-center underline"
          >
            Search documentation
          </Link>
          <Link
            to="/developers/$docSlug"
            params={{ docSlug: "api-reference" }}
            className="inline-flex min-h-11 items-center underline"
          >
            API reference
          </Link>
          <Link
            to="/developers/$docSlug"
            params={{ docSlug: "api-pricing" }}
            className="inline-flex min-h-11 items-center underline"
          >
            Pricing
          </Link>
        </div>
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
