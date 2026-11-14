import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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

const modelExamples = {
  cURL: 'curl -H "Authorization: Bearer $KOVA_API_KEY" https://kovagpt.com/api/v1/models',
  JavaScript: `const response = await fetch(
  "https://kovagpt.com/api/v1/models",
  { headers: { Authorization: "Bearer " + process.env.KOVA_API_KEY } },
);
if (!response.ok) throw new Error(await response.text());
console.log(await response.json());`,
} as const;

function DevelopersOverview() {
  const [language, setLanguage] = useState<keyof typeof modelExamples>("cURL");
  return (
    <PublicPageView
      showcase
      heroMedia={
        <div className="kova-showcase-screen rounded-xl border border-border">
          <div
            role="group"
            aria-label="Code language"
            className="flex flex-wrap gap-1 border-b border-border p-2"
          >
            {(Object.keys(modelExamples) as (keyof typeof modelExamples)[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === language}
                aria-controls="model-catalog-code"
                className="min-h-11 rounded-lg px-3 text-sm hover:bg-muted aria-pressed:bg-foreground aria-pressed:text-background"
                onClick={() => setLanguage(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <pre
            id="model-catalog-code"
            aria-label={`${language} model catalog example`}
            tabIndex={0}
            className="kova-showcase-code p-4 font-mono text-sm leading-7"
          >
            <code>{modelExamples[language]}</code>
          </pre>
        </div>
      }
      eyebrow="Developers"
      title="Build with the KovaGPT API"
      summary="Generate text and images or create embeddings through the KovaGPT API. Manage keys and spending in one console."
      primaryAction={{ label: "Open developer console", to: "/developers/console" }}
      secondaryAction={{ label: "Read the quickstart", to: "/developers/quickstart" }}
    >
      <article className="kova-showcase-enter min-w-0 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Start with the model catalog</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          List the models available to your key before requesting a generation quote.
        </p>
      </article>
      <article className="kova-showcase-enter min-w-0 rounded-2xl border border-border bg-background p-6 sm:p-8">
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
