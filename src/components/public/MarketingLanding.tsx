import { PricingPage } from "./PricingPlans";
import { useEffect, useState } from "react";
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
const samples = {
  Python: `import os\nimport requests\n\n# Discover models available to your key.\nresponse = requests.get(\n    "https://kovagpt.com/api/v1/models",\n    headers={\n        "Authorization": "Bearer " + os.environ["KOVA_API_KEY"]\n    },\n    timeout=30,\n)\nresponse.raise_for_status()\n\nfor model in response.json().get("data", []):\n    print(model["id"])`,
  JavaScript: `const response = await fetch(\n  "https://kovagpt.com/api/v1/models",\n  {\n    headers: {\n      Authorization: "Bearer " + process.env.KOVA_API_KEY,\n    },\n  },\n);\n\nif (!response.ok) throw new Error(await response.text());\nconst catalog = await response.json();\nconsole.log(catalog);`,
  cURL: `curl https://kovagpt.com/api/v1/models \\\n  -H "Authorization: Bearer $KOVA_API_KEY"`,
};
function DemoCode() {
  const [language, setLanguage] = useState<keyof typeof samples>("Python");
  const [copied, setCopied] = useState(false);
  return (
    <div className="editor-code">
      <div className="editor-code-bar">
        <div role="group" aria-label="Code language">
          {(Object.keys(samples) as (keyof typeof samples)[]).map((l) => (
            <button
              type="button"
              key={l}
              aria-pressed={language === l}
              onClick={() => {
                setLanguage(l);
                setCopied(false);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(samples[language]);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre aria-label={`${language} model catalog example`}>
        <code>
          {samples[language].split("\n").map((line, index) => (
            <span className="editor-code-line" key={index}>
              <span className="editor-line-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={
                  line.trim().startsWith("#")
                    ? "syntax-comment"
                    : line.includes('"')
                      ? "syntax-string"
                      : /import|const|for |if |print/.test(line)
                        ? "syntax-keyword"
                        : ""
                }
              >
                {line || " "}
              </span>
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
      <div className="editor-code-foot">
        GET /api/v1/models <span>Model discovery</span>
      </div>
    </div>
  );
}
function ProductGallery() {
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const id = window.setInterval(() => {
      if (!media.matches && !document.hidden) setFrame((i) => (i + 1) % 6);
    }, 2000);
    return () => clearInterval(id);
  }, [paused]);
  return (
    <div className="editor-gallery">
      {[0, 1, 2].map((lane) => (
        <div className="editor-gallery-lane" key={lane}>
          {Array.from({ length: 6 }, (_, i) => (
            <img
              key={i}
              src={`/marketing/scene-${i + 1}.jpg`}
              alt={i === (frame + lane) % 6 ? "Image creation example" : ""}
              aria-hidden={i !== (frame + lane) % 6}
              className={i === (frame + lane) % 6 ? "active" : ""}
            />
          ))}
        </div>
      ))}
      <div className="editor-gallery-shade" />
      <div className="editor-gallery-caption">
        <div>
          <small>CREATE IMAGES</small>
          <h2>See where an idea takes you.</h2>
          <a href="/features/images">
            Explore images <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
        <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  );
}
function GuideRows({ page }: { page: Exclude<MarketingLandingKey, "news"> }) {
  return (
    <div className="editor-rows">
      {cards[page].map(([title, description, to], i) => (
        <a href={to} key={to}>
          <span className="editor-row-number">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <ArrowUpRight aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}
function WorkspaceStudy() {
  return (
    <div className="editor-workspace" aria-label="Illustrative project workspace">
      <div className="workspace-top">
        <span>
          <Folder aria-hidden="true" /> Launch plan
        </span>
        <small>EXAMPLE PROJECT</small>
      </div>
      <div className="workspace-body">
        <aside>
          <span className="workspace-selected">Overview</span>
          <span>Research</span>
          <span>Drafts</span>
          <span>Files</span>
          <hr />
          <small>PROJECT CONTEXT</small>
          <p>
            Audience notes
            <br />
            Brand guidelines
            <br />
            Launch brief
          </p>
        </aside>
        <div className="workspace-document">
          <small>PROJECT BRIEF</small>
          <h3>
            A clearer path
            <br />
            from idea to launch.
          </h3>
          <p>
            Bring your notes together. Identify the open questions. Turn the next conversation into
            a useful draft.
          </p>
          <div className="document-rule" />
          <div className="document-rule short" />
          <div className="workspace-chips">
            <span>Research</span>
            <span>Outline</span>
            <span>Draft</span>
          </div>
        </div>
      </div>
    </div>
  );
}
export function MarketingLanding({ page }: { page: MarketingLandingKey }) {
  const item = MARKETING_LANDINGS[page];
  const articles = PUBLICATIONS.filter((p) => p.section === "news");
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className={`marketing-page editorial-v2 editorial-${page}`}
      >
        {page === "features" && (
          <>
            <section className="editor-heading">
              <p className="editor-label">KOVAGPT / PRODUCTS</p>
              <div className="editor-heading-split">
                <h1>
                  More ways
                  <br />
                  to make it happen.
                </h1>
                <div>
                  <p>
                    From the first question to the finished work. Explore what you can do with
                    KovaGPT.
                  </p>
                  <a className="editor-pill" href="/">
                    Open KovaGPT
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              </div>
            </section>
            <ProductGallery />
            <section className="editor-product-row">
              <div className="editor-section-copy">
                <p className="editor-label">YOUR WORK, CONNECTED</p>
                <h2>
                  A place for the
                  <br />
                  whole project.
                </h2>
                <p>
                  Keep the files, conversations, and instructions that belong together in one place.
                </p>
                <a href="/features/projects">
                  Explore Projects
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
              <WorkspaceStudy />
            </section>
            <section className="editor-directory">
              <div>
                <p className="editor-label">EXPLORE KOVAGPT</p>
                <h2>Find your next tool.</h2>
              </div>
              <GuideRows page="features" />
            </section>
          </>
        )}
        {page === "developers" && (
          <>
            <section className="editor-heading developer-heading">
              <p className="editor-label">KOVAGPT / DEVELOPERS</p>
              <h1>
                Build something
                <br />
                worth using.
              </h1>
              <p className="editor-intro">
                Bring KovaGPT into your application. Discover the models, explore the API, and start
                with a scoped key.
              </p>
              <div className="editor-actions">
                <a className="editor-pill" href="/developers/console">
                  Open console
                  <ArrowUpRight aria-hidden="true" />
                </a>
                <a href="/developers/quickstart">
                  Read the quickstart
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </section>
            <section className="editor-developer-grid">
              <div className="editor-section-copy">
                <p className="editor-label">A SIMPLE START</p>
                <h2>Your first request.</h2>
                <p>
                  List the models available to your key. Then use the documentation to request a
                  quote and build your integration.
                </p>
                <a href="/developers/authentication">
                  Authentication guide
                  <ArrowUpRight aria-hidden="true" />
                </a>
                <div className="editor-api-note">
                  Keep API keys on your server. Available operations depend on your account,
                  budgets, and platform configuration.
                </div>
              </div>
              <DemoCode />
            </section>
            <section className="editor-directory">
              <div>
                <p className="editor-label">DEVELOPER RESOURCES</p>
                <h2>Go from here.</h2>
              </div>
              <GuideRows page="developers" />
            </section>
          </>
        )}
        {page === "business" && (
          <>
            <section className="editor-heading business-heading">
              <p className="editor-label">KOVAGPT / BUSINESS</p>
              <h1>
                Less scattered.
                <br />
                More focused.
              </h1>
              <div className="editor-heading-split">
                <p className="editor-intro">
                  Research, writing, and everyday projects—brought into one workspace.
                </p>
                <a className="editor-pill" href="/contact-support">
                  Contact sales
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </section>
            <div className="editor-business-stage">
              <WorkspaceStudy />
            </div>
            <section className="editor-business-copy">
              <h2>
                Give the work
                <br />
                some context.
              </h2>
              <div>
                <p>
                  A brief. A set of notes. The documents you keep coming back to. Bring the right
                  material into a project, then work through the next step with KovaGPT.
                </p>
                <a href="/features/projects">
                  See how Projects work
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </section>
            <GuideRows page="business" />
            <section className="editor-contact">
              <p>
                Find the right fit
                <br />
                for your work.
              </p>
              <a className="editor-pill" href="/contact-support">
                Talk to us
                <ArrowUpRight aria-hidden="true" />
              </a>
            </section>
          </>
        )}
        {page === "info" && (
          <>
            <section className="editor-heading">
              <p className="editor-label">KOVAGPT / INFO</p>
              <h1>
                A little guidance.
                <br />A lot of possibility.
              </h1>
              <p className="editor-intro">
                Get started, explore the tools, and understand your controls.
              </p>
            </section>
            <section className="editor-info-layout">
              <div className="editor-info-feature">
                <p className="editor-label">START HERE</p>
                <h2>
                  Make your first
                  <br />
                  conversation count.
                </h2>
                <p>
                  Tell KovaGPT what you’re working on, what you already know, and what a useful
                  answer should look like.
                </p>
                <div className="editor-prompt">
                  “Help me turn these notes into a clear plan. Start with the three most important
                  next steps.”
                </div>
                <a className="editor-pill" href="/help/getting-started">
                  Getting started
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
              <GuideRows page="info" />
            </section>
            <section className="editor-info-bottom">
              <div>
                <p className="editor-label">YOUR CHOICES</p>
                <h2>
                  Your workspace.
                  <br />
                  Your controls.
                </h2>
              </div>
              <p>
                Learn how history, memory, and data settings work, and choose what’s right for you.
                <a href="/data-controls">
                  Explore data controls
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </p>
            </section>
          </>
        )}
        {page === "news" && (
          <>
            <section className="editor-heading editor-news-heading">
              <p className="editor-label">ARTICLES / KOVAPEDIA</p>
              <h1>Inside KovaGPT.</h1>
              <p className="editor-intro">
                Stories about the models, the product, and what comes next.
              </p>
            </section>
            <section className="editor-news-list" aria-label="Kovapedia articles">
              {articles.map((article, i) => (
                <a
                  className={i === 0 ? "editor-lead-story" : "editor-story"}
                  href={`/news/${article.slug}`}
                  key={article.slug}
                >
                  <PublicationArtwork slug={article.slug} />
                  <div>
                    <small>
                      {article.slug === "argon" || article.slug === "neon" ? "MODELS" : "PRODUCT"} /{" "}
                      {article.publishedAt}
                    </small>
                    <h2>{article.title}</h2>
                    <p>{article.description}</p>
                    <span>
                      Read article
                      <ArrowUpRight aria-hidden="true" />
                    </span>
                  </div>
                </a>
              ))}
            </section>
          </>
        )}
        {page !== "business" && <PricingPage embedded />}
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
