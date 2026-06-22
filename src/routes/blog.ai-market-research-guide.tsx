import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://nova-aigpt.lovable.app/blog/ai-market-research-guide";
const TITLE = "How to Use AI for Market Research in 2026";
const DESCRIPTION =
  "A practical workflow for using AI for market research: size markets, map competitors, and synthesize trends with NovaGPT's Research and Reasoning modes.";

export const Route = createFileRoute("/blog/ai-market-research-guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: CANONICAL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESCRIPTION,
          datePublished: "2026-06-22",
          dateModified: "2026-06-22",
          author: { "@type": "Organization", name: "NovaGPT" },
          publisher: { "@type": "Organization", name: "NovaGPT" },
          mainEntityOfPage: CANONICAL,
        }),
      },
    ],
  }),
  component: MarketResearchGuide,
});

function MarketResearchGuide() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 text-foreground">
      <p className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">
        Guide · Market research
      </p>
      <h1 className="mb-4 text-3xl font-bold sm:text-4xl">
        How to Use AI for Market Research in 2026
      </h1>
      <p className="mb-8 text-lg text-muted-foreground">
        A repeatable workflow that turns vague questions like "is this market big enough?" into
        a structured competitor map, sizing model, and trend brief  -  using AI as the analyst
        and you as the editor.
      </p>

      <section className="mb-10 space-y-4">
        <h2 className="text-2xl font-semibold">Why AI changes market research</h2>
        <p>
          Traditional market research is slow: surveys, analyst reports, manual SERP scraping,
          and weeks of synthesis. Modern AI assistants compress that loop. The catch is that
          general chatbots hallucinate numbers and miss recent events. The fix is a structured
          workflow plus a model that can actually search the live web  -  that's where
          NovaGPT's <strong>Research</strong> and <strong>Reasoning</strong> modes earn their
          keep.
        </p>
      </section>

      <section className="mb-10 space-y-4">
        <h2 className="text-2xl font-semibold">The 5-step AI market research workflow</h2>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong>Frame the question.</strong> Write the decision the research has to inform
            in one sentence. ("Should we launch an AI invoice tool for UK freelancers in
            Q3?") Vague questions produce vague AI output.
          </li>
          <li>
            <strong>Size the market.</strong> Switch NovaGPT to <em>Research</em> mode and ask
            for TAM / SAM / SOM with sources. Force citations: <em>"give me three independent
            sources for each number; flag any estimate older than 18 months."</em>
          </li>
          <li>
            <strong>Map competitors.</strong> Ask for 8-12 competitors with pricing, target
            segment, distribution channel, and recent funding. Have NovaGPT output a comparison
            table you can paste into a spreadsheet.
          </li>
          <li>
            <strong>Synthesize trends.</strong> Switch to <em>Reasoning</em> mode. Paste the
            competitor table back in and ask: <em>"what 3 structural trends explain this
            landscape, and what does each imply for a new entrant?"</em>
          </li>
          <li>
            <strong>Pressure-test.</strong> Open a fresh chat in <em>Precise</em> mode and ask
            it to argue the opposite position. If the bull and bear cases share the same data,
            your read is solid.
          </li>
        </ol>
      </section>

      <section className="mb-10 space-y-4">
        <h2 className="text-2xl font-semibold">Why mode-switching matters</h2>
        <p>
          One-size-fits-all chatbots blur retrieval, reasoning, and writing into a single
          response  -  which is exactly why they hallucinate in research. NovaGPT exposes the
          modes separately so you can grade each step on its own:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Research</strong> pulls live web data and forces source citations. Use it
            for sizing, competitor lists, and recent news.
          </li>
          <li>
            <strong>Reasoning</strong> spends more compute on multi-step inference. Use it for
            "what does this mean?" synthesis after you have the data.
          </li>
          <li>
            <strong>Precise</strong> minimizes creative drift. Use it for adversarial review.
          </li>
          <li>
            <strong>Writer</strong> turns the brief into a polished memo or deck outline.
          </li>
        </ul>
      </section>

      <section className="mb-10 space-y-4">
        <h2 className="text-2xl font-semibold">Prompts you can copy</h2>
        <div className="space-y-4 rounded-lg border border-border bg-card p-4 text-sm">
          <p>
            <strong>Sizing:</strong> "Estimate the 2026 global market size for [X]. Give
            TAM, SAM, and SOM with three sources each. Reject any source older than 18 months
            unless no newer one exists. Show the math."
          </p>
          <p>
            <strong>Competitor map:</strong> "List 10 companies competing in [X]. For each,
            return: pricing, target segment, GTM channel, last funding round, and one
            differentiator. Output as a markdown table."
          </p>
          <p>
            <strong>Trend synthesis:</strong> "Based on the table above, what are the three
            structural trends shaping this market? For each trend, give a non-obvious
            implication for a new entrant."
          </p>
          <p>
            <strong>Red team:</strong> "Argue why launching in this market is a bad idea in
            2026. Use only data already cited above."
          </p>
        </div>
      </section>

      <section className="mb-10 space-y-4">
        <h2 className="text-2xl font-semibold">Mistakes to avoid</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Trusting numbers without citations. If the model refuses to cite, the number isn't
            reliable.
          </li>
          <li>
            Running the whole workflow in one chat. Switch modes  -  research and synthesis
            reward different settings.
          </li>
          <li>
            Skipping the red team. The opposing case is where AI research earns its time
            savings back.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">Try this workflow in NovaGPT</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Research and Reasoning modes are available on the free tier. Sign in and run the
          first sizing prompt in under a minute.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          Open NovaGPT
        </Link>
      </section>
    </article>
  );
}
