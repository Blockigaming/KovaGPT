import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

const CANONICAL = "https://kovagpt.com/blog/ai-market-research-guide";
const DESCRIPTION =
  "A practical workflow for using AI in market research while checking sources, dates, assumptions, and uncertainty.";

export const Route = createFileRoute("/blog/ai-market-research-guide")({
  head: () => ({
    meta: [
      {
        title: "How to Use AI for Market Research: A Verification-First Guide | KovaGPT",
      },
      { name: "description", content: DESCRIPTION },
      {
        property: "og:title",
        content: "How to Use AI for Market Research: A Verification-First Guide",
      },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
      { property: "og:image", content: "https://kovagpt.com/og/writer.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "How to Use AI for Market Research: A Verification-First Guide",
      },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: "https://kovagpt.com/og/writer.jpg" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "How to Use AI for Market Research: A Verification-First Guide",
          description: DESCRIPTION,
          datePublished: "2026-06-21",
          dateModified: "2026-08-01",
          author: { "@type": "Organization", name: "KovaGPT" },
          publisher: { "@type": "Organization", name: "KovaGPT" },
          mainEntityOfPage: CANONICAL,
        }),
      },
    ],
  }),
  component: AiMarketResearchGuide,
});

function AiMarketResearchGuide() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 text-foreground"
      >
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span>Blog</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">AI market research guide</span>
        </nav>

        <article className="prose prose-invert max-w-none">
          <h1 className="text-4xl font-bold tracking-tight">
            How to Use AI for Market Research Without Losing the Evidence
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Updated August 1, 2026 · 8 min read</p>

          <p className="mt-6 text-lg leading-relaxed">
            AI can speed up question framing, source discovery, comparison, and drafting. It cannot
            guarantee that a number is current, a citation supports a claim, or a source is
            reliable. The safest workflow keeps the evidence visible and separates sourced facts
            from estimates and interpretation.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">1. Start with a decision</h2>
          <p>
            Write the decision in one sentence, then define geography, customer, time period, and
            the confidence you need. For example:{" "}
            <em>Should we test a paid bookkeeping product with UK freelancers in Q4 2026?</em> A
            bounded question makes it easier to reject irrelevant data.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">2. Build an evidence plan</h2>
          <p>List the minimum evidence needed before searching:</p>
          <ul>
            <li>market definition and exclusions;</li>
            <li>customer count or addressable population;</li>
            <li>price or spend assumptions;</li>
            <li>competitor and substitute set;</li>
            <li>source date, publisher, method, and known limitations.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-semibold">3. Use KovaGPT Search deliberately</h2>
          <p>
            Select Search when you need recent or source-backed information. KovaGPT does not search
            on every prompt: search is conditional, users can explicitly disable it, and it requires
            a configured and available search provider. A failed or empty search should not be
            treated as proof that no evidence exists.
          </p>
          <p>
            Ask for the source title, publisher, publication date, and the exact claim each source
            is meant to support. Then open the links yourself. A well-formatted citation can still
            point to a weak, outdated, or misread page.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">4. Use Deep Research only when eligible</h2>
          <p>
            KovaGPT Deep Research is available to eligible signed-in Plus and Pro accounts. It also
            depends on working search and AI providers. It can plan a research pass and assemble a
            cited report, but the output remains AI-generated and must be checked against the
            underlying sources.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">5. Triangulate important claims</h2>
          <p>
            Prefer primary sources such as government data, regulator filings, company disclosures,
            documented surveys, and original research. For a consequential number, look for a second
            independent source or reproduce the calculation. Record disagreements instead of
            averaging them away.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">
            6. Label facts, inferences, and estimates
          </h2>
          <p>Use three explicit buckets in the draft:</p>
          <ul>
            <li>
              <strong>Sourced fact:</strong> directly supported by an opened source.
            </li>
            <li>
              <strong>Inference:</strong> your interpretation of several facts.
            </li>
            <li>
              <strong>Estimate:</strong> a calculation with visible assumptions and a range.
            </li>
          </ul>
          <p>
            This prevents a polished paragraph from making assumptions look as certain as published
            data.
          </p>

          <h2 className="mt-10 text-2xl font-semibold">7. Pressure-test the result</h2>
          <p>
            Ask what evidence would change the conclusion, which segment was omitted, and where the
            oldest source sits. Recalculate headline numbers in a spreadsheet and have a human
            reviewer open the most important sources before a board, investor, legal, or
            customer-facing use.
          </p>

          <h2 className="mt-12 text-2xl font-semibold">Prompt template</h2>
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm">
            {`Decision: [one sentence]
Scope: [customer, geography, time period]
Evidence needed: [list]

Use Search if it is available. For each factual claim, provide the source title,
publisher, date, and link. Separate sourced facts, inferences, and estimates.
State when a source cannot be opened or when evidence is missing. Do not invent citations.`}
          </pre>

          <h2 className="mt-12 text-2xl font-semibold">Availability and verification</h2>
          <p>
            KovaGPT can make mistakes, including with retrieved material. Search and Deep Research
            are provider-dependent. The <Link to="/pricing">Pricing page</Link> and in-product
            controls show current account eligibility; neither plan access nor a citation guarantees
            correctness.
          </p>

          <p className="mt-10">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open KovaGPT
            </Link>
          </p>
        </article>
      </main>
    </PublicShell>
  );
}
