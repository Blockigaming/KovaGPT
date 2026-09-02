import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { DAILY_IMAGE_LIMIT_BY_TIER, modesForTier, type Tier } from "@/lib/modes";

const CANONICAL = "https://kovagpt.com/blog/best-ai-assistants";
const DESCRIPTION =
  "A criteria-first guide to choosing an AI assistant in 2026, with current KovaGPT plan facts and clear provider caveats.";
const INDEPENDENCE_DISCLOSURE =
  "KovaGPT is not affiliated with, endorsed by, or sponsored by OpenAI or ChatGPT.";

const FAQ = [
  {
    q: "Which AI assistant is best?",
    a: "There is no universal winner. Compare the current official plan, privacy, source, file, integration, and usage-limit pages for the tasks you actually perform.",
  },
  {
    q: "Does KovaGPT always search the live web?",
    a: "No. Search is conditional, can be explicitly disabled, and depends on a configured and available search provider. Use the Search tool when current sources matter.",
  },
  {
    q: "Who can use KovaGPT Deep Research?",
    a: "Deep Research is available to eligible signed-in Plus and Pro accounts and still depends on available search and AI providers.",
  },
  {
    q: "Can an AI assistant guarantee accurate answers or citations?",
    a: "No. AI output and citations can be wrong, incomplete, or outdated. Open important sources, prefer primary material, and verify consequential claims yourself.",
  },
];

const PLAN_LABELS: Record<Tier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
};

export const Route = createFileRoute("/blog/best-ai-assistants")({
  head: () => ({
    meta: [
      { title: "How to Choose an AI Assistant in 2026 | KovaGPT" },
      { name: "description", content: DESCRIPTION },
      {
        property: "og:title",
        content: "How to Choose an AI Assistant in 2026",
      },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
      { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "How to Choose an AI Assistant in 2026",
      },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: "https://kovagpt.com/og/home.jpg" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "How to Choose an AI Assistant in 2026",
          description: DESCRIPTION,
          datePublished: "2026-06-20",
          dateModified: "2026-08-01",
          author: { "@type": "Organization", name: "KovaGPT" },
          publisher: { "@type": "Organization", name: "KovaGPT" },
          mainEntityOfPage: CANONICAL,
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }),
      },
    ],
  }),
  component: BestAiAssistantsPage,
});

function BestAiAssistantsPage() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 text-foreground"
      >
        <p className="mb-6 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {INDEPENDENCE_DISCLOSURE}
        </p>
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span>Blog</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">Choosing an AI assistant</span>
        </nav>

        <article className="prose prose-invert max-w-none">
          <h1 className="text-4xl font-bold tracking-tight">
            How to Choose an AI Assistant in 2026
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Updated August 1, 2026 · 7 min read</p>

          <p className="mt-6 text-lg leading-relaxed">
            The best assistant is the one whose current product, limits, and privacy terms fit your
            work. Static rankings age quickly. ChatGPT, Claude, Gemini, Microsoft Copilot,
            Perplexity, KovaGPT, and other products can change plans and capabilities without this
            article changing at the same time, so verify material details on each product's official
            pages before paying.
          </p>

          <aside className="my-8 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            KovaGPT publishes this guide. KovaGPT is independently developed and is not affiliated
            with, endorsed by, or sponsored by the third-party products named here. Product names
            belong to their respective owners.
          </aside>

          <h2 className="mt-10 text-2xl font-semibold">Use a task-based comparison</h2>
          <ul>
            <li>
              <strong>Answer quality:</strong> test the same representative prompts and check
              important facts rather than trusting a demo or benchmark headline.
            </li>
            <li>
              <strong>Sources:</strong> check whether search is available for your plan and whether
              you can open the cited pages. A citation is evidence to inspect, not a guarantee.
            </li>
            <li>
              <strong>Workflow:</strong> test the files, projects, connected apps, sharing, and
              export paths you actually need.
            </li>
            <li>
              <strong>Privacy and control:</strong> read the current privacy terms and confirm
              deletion, retention, and connected-app controls in the product.
            </li>
            <li>
              <strong>Total cost:</strong> compare the live checkout price, quotas, trial
              eligibility, and provider-dependent features, not only the plan name.
            </li>
          </ul>

          <h2 className="mt-12 text-2xl font-semibold">Current KovaGPT mode access</h2>
          <p>
            KovaGPT's public plan pages are generated from the same mode catalog used for
            server-side entitlement checks. The current plan menus are:
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Plan</th>
                  <th className="p-3 text-left">Modes</th>
                  <th className="p-3 text-left">Daily images</th>
                </tr>
              </thead>
              <tbody>
                {(["free", "plus", "pro"] as const).map((tier) => (
                  <tr key={tier} className="border-t border-border">
                    <td className="p-3 font-medium">{PLAN_LABELS[tier]}</td>
                    <td className="p-3">
                      {modesForTier(tier)
                        .map((mode) => mode.label)
                        .join(", ")}
                    </td>
                    <td className="p-3">{DAILY_IMAGE_LIMIT_BY_TIER[tier]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Image generation requires a signed-in, verified account and an available image provider.
            Search is conditional and provider-dependent. Deep Research requires a signed-in Plus or
            Pro account and available search and AI providers.
          </p>

          <h2 className="mt-12 text-2xl font-semibold">
            Run a short evaluation before subscribing
          </h2>
          <ol>
            <li>Choose five real tasks, including one where a wrong answer would be obvious.</li>
            <li>Use the same input and source files in each product where permitted.</li>
            <li>Record whether the answer is correct, useful, editable, and easy to verify.</li>
            <li>Test the usage limit and recovery behavior that matters to your workflow.</li>
            <li>Review the live price and terms immediately before purchase.</li>
          </ol>

          <h2 className="mt-12 text-2xl font-semibold">KovaGPT availability notes</h2>
          <p>
            KovaGPT can make mistakes. Search, research, images, connected apps, and some account
            features depend on plan eligibility, configuration, region, maintenance state, and
            external providers. The live product, <Link to="/pricing">Pricing page</Link>, and
            in-product usage display are the source of truth for a particular account.
          </p>

          <h2 className="mt-12 text-2xl font-semibold">Frequently asked questions</h2>
          {FAQ.map((item) => (
            <section key={item.q} className="mt-5">
              <h3 className="text-lg font-medium">{item.q}</h3>
              <p>{item.a}</p>
            </section>
          ))}

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
