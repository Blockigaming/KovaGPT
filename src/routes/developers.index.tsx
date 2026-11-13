import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPageView } from "@/components/public/PublicSite";

export const Route = createFileRoute("/developers/")({
  component: DevelopersOverview,
  head: () => ({
    meta: [
      { title: "KovaGPT API | Developer Platform" },
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
      title="Bring KovaGPT into your app"
      summary="Generate text and images or create embeddings through the KovaGPT API. Manage keys and spending in one console."
      primaryAction={{ label: "Open developer console", to: "/developers/console" }}
      secondaryAction={{ label: "Read the quickstart", to: "/developers/quickstart" }}
    >
      <article className="min-w-0 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Start with the model catalog</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          List the models available to your key before requesting a generation quote.
        </p>
        <pre
          aria-label="List models with curl"
          className="mt-6 overflow-x-auto rounded-xl border border-border bg-muted p-4 font-mono text-sm leading-7"
        >
          <code>
            {
              'curl https://kovagpt.com/api/v1/models \\\n  -H "Authorization: Bearer $KOVA_API_KEY"'
            }
          </code>
        </pre>
      </article>
      <article className="min-w-0 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Set your budget before you run</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          Use a scoped key, request a quote, and review the estimated cost. The console shows
          whether your account can fund and run paid requests.
        </p>
        <Link
          to="/developers/pricing"
          className="mt-4 inline-flex min-h-11 items-center underline underline-offset-4"
        >
          View API pricing
        </Link>
      </article>
    </PublicPageView>
  );
}
