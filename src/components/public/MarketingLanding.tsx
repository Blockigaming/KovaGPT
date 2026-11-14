import { ArrowUpRight, Code2, Folder, Image, MessageSquare, Search, Mic } from "lucide-react";
import { PublicShell } from "./PublicShell";
import { PUBLICATIONS, type Publication } from "@/lib/publications";

const cards = {
  features: [
    ["Chat", "A question is a good place to start.", "/features/chat", MessageSquare],
    ["Projects", "Keep the work, files, and context together.", "/features/projects", Folder],
    ["Images", "Take an idea somewhere visual.", "/features/images", Image],
    ["Code", "Work through the next line—and the bigger picture.", "/features/code", Code2],
    ["Search", "Follow the sources behind an answer.", "/features/search", Search],
    ["Voice", "Give your next conversation a voice.", "/features/voice", Mic],
  ],
  info: [
    [
      "Getting started",
      "Your first conversation, files, and projects.",
      "/help/getting-started",
      MessageSquare,
    ],
    ["Feature guides", "Find out what you can do with KovaGPT.", "/features", Search],
    ["Your data", "Understand history, memory, and your controls.", "/data-controls", Folder],
    ["Help Center", "Answers and support when you need them.", "/help", MessageSquare],
  ],
  developers: [
    ["Quickstart", "Make your first authenticated request.", "/developers/quickstart", Code2],
    ["Models", "Explore the available model catalog.", "/developers/models", Search],
    [
      "Documentation",
      "Request formats, authentication, and responses.",
      "/developers/docs",
      Folder,
    ],
    ["API pricing", "Understand usage before you build.", "/developers/pricing", Code2],
  ],
  business: [
    [
      "Writing & research",
      "Move from scattered notes to a useful first draft.",
      "/use-cases",
      MessageSquare,
    ],
    ["Projects", "Organize ongoing work around the right context.", "/features/projects", Folder],
    ["Data controls", "Make informed choices about what you share.", "/data-controls", Search],
    [
      "Talk to us",
      "Discuss your requirements and available options.",
      "/contact-support",
      MessageSquare,
    ],
  ],
} as const;
export const MARKETING_LANDINGS = {
  features: {
    label: "Products",
    title: "An idea. A conversation. A next step.",
    description:
      "Explore the tools inside KovaGPT. Write, research, create, and keep your work moving.",
    action: "Open KovaGPT",
    to: "/",
  },
  info: {
    label: "Info",
    title: "Get to know KovaGPT.",
    description:
      "A clear place to start. Explore the guides, understand your controls, and find the help you need.",
    action: "Get started",
    to: "/help/getting-started",
  },
  developers: {
    label: "Developers",
    title: "Your next idea, built with KovaGPT.",
    description:
      "Explore the API, choose an available model, and connect your application. Start with the documentation and your developer account.",
    action: "Read the quickstart",
    to: "/developers/quickstart",
  },
  business: {
    label: "Business",
    title: "Make room for your best work.",
    description:
      "Bring more clarity to research, writing, and everyday projects. Explore how KovaGPT can fit the way you work.",
    action: "Contact sales",
    to: "/contact-support",
  },
  news: {
    label: "Kovapedia",
    title: "What’s happening at KovaGPT.",
    description: "Meet the models. Explore the product. See what you can build.",
    action: "Explore KovaGPT",
    to: "/overview",
  },
} as const;
export type MarketingLandingKey = keyof typeof MARKETING_LANDINGS;
export function PublicationArtwork({ slug }: { slug: string }) {
  if (slug === "argon" || slug === "neon")
    return (
      <div className={`news-art ${slug}`}>
        <div className={`model-face ${slug}-face`} aria-hidden="true">
          <i />
          <i />
          <b />
        </div>
        <strong>{slug === "argon" ? "Argon" : "Neon"}</strong>
      </div>
    );
  const api = slug === "developer-platform";
  return (
    <div className={`news-art ${api ? "api-art" : "interface"}`}>
      <div className={`matching-mark ${api ? "api-mark" : "workspace-mark product-brand-mark"}`}>
        {api ? <Code2 aria-hidden="true" /> : <img src="/kova-logo.png" alt="" />}
      </div>
      <strong className="matching-name">{api ? "KovaGPT API" : "KovaGPT"}</strong>
    </div>
  );
}
export function MarketingLanding({ page }: { page: MarketingLandingKey }) {
  const item = MARKETING_LANDINGS[page];
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className={`marketing-page marketing-${page}`}>
        <section className="marketing-hero">
          <div>
            <p className="marketing-eyebrow">{item.label}</p>
            <h1>{item.title}</h1>
            <p className="marketing-lede">{item.description}</p>
            <a className="marketing-action" href={item.to}>
              {item.action}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          {page !== "news" && (
            <div className={`marketing-art art-${page}`} aria-hidden="true">
              {page === "developers" ? (
                <pre>
                  <code>
                    <span>import</span> os
                    <br />
                    <span>import</span> requests
                    <br />
                    <br />
                    response = requests.get(
                    <br /> <b>"https://kovagpt.com/api/v1/models"</b>,<br /> headers=&#123;
                    <br /> <b>"Authorization"</b>: <em>"Bearer "</em> +<br /> os.environ[
                    <b>"KOVA_API_KEY"</b>]<br /> &#125;,
                    <br /> timeout=<em>30</em>,<br />)<br />
                    response.raise_for_status()
                    <br />
                    <span>print</span>(response.json())
                  </code>
                </pre>
              ) : (
                <>
                  <div className="marketing-orbit" />
                  <img src="/kova-logo.png" alt="" />
                  <span>
                    {page === "business"
                      ? "Space for the work that matters."
                      : page === "info"
                        ? "A little context goes a long way."
                        : "Think it. Make it. Keep going."}
                  </span>
                </>
              )}
            </div>
          )}
        </section>
        {page === "news" ? (
          <section className="marketing-collection" aria-label="Kovapedia articles">
            <div className="news-grid">
              {PUBLICATIONS.filter((p) => p.section === "news").map((p) => (
                <a key={p.slug} href={`/news/${p.slug}`}>
                  <PublicationArtwork slug={p.slug} />
                  <small>Product · {p.publishedAt}</small>
                  <h2>{p.title}</h2>
                  <p>{p.description}</p>
                </a>
              ))}
            </div>
          </section>
        ) : (
          <section className="marketing-collection" aria-label={`${item.label} guides`}>
            <div className="marketing-section-title">
              <h2>
                {page === "features"
                  ? "Find your next possibility."
                  : page === "developers"
                    ? "From first request to what’s next."
                    : page === "business"
                      ? "Built around your day."
                      : "Start here. Go anywhere."}
              </h2>
              <a href={page === "developers" ? "/developers/docs" : "/features"}>
                Explore the guides
                <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <div className="marketing-card-grid">
              {cards[page].map(([title, description, to, Icon]) => (
                <a className="marketing-card" href={to} key={to}>
                  <Icon aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span>
                    Explore
                    <ArrowUpRight aria-hidden="true" />
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
        <section className="marketing-closing">
          <p>Make it your everyday AI.</p>
          <a className="marketing-action" href="/pricing">
            Explore plans
            <ArrowUpRight aria-hidden="true" />
          </a>
        </section>
      </main>
    </PublicShell>
  );
}
export function MarketingPublication({ item }: { item: Publication }) {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="marketing-story">
        <a className="marketing-back" href="/news">
          ← Kovapedia
        </a>
        <header>
          <p className="marketing-eyebrow">
            KovaGPT · <time dateTime={item.publishedAt}>{item.publishedAt}</time>
          </p>
          <h1>{item.title}</h1>
          <p className="marketing-lede">{item.description}</p>
        </header>
        <PublicationArtwork slug={item.slug} />
        <article aria-label={item.title}>
          {item.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </article>
        <a className="marketing-action" href="/news">
          All articles
          <ArrowUpRight aria-hidden="true" />
        </a>
      </main>
    </PublicShell>
  );
}
