import "./public-website.css";
import "./product-showcase.css";
import { Link } from "@tanstack/react-router";
import { PublicShell } from "./PublicShell";
import type { WebsitePage } from "@/lib/public-website-catalog.mjs";

export function websitePageHead(item: WebsitePage) {
  return {
    meta: [
      { title: `${item.title} | KovaGPT` },
      { name: "description", content: item.description },
      { name: "robots", content: item.indexable ? "index, follow" : "noindex, follow" },
      { property: "og:title", content: `${item.title} | KovaGPT` },
      { property: "og:description", content: item.description },
      { property: "og:url", content: `https://kovagpt.com${item.path}` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
    ],
    links: [{ rel: "canonical", href: `https://kovagpt.com${item.path}` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: item.title,
          description: item.description,
          url: `https://kovagpt.com${item.path}`,
        }),
      },
    ],
  };
}

export function PublicWebsiteArticle({ item }: { item: WebsitePage }) {
  const showcase = item.path === "/features";
  const category = item.path.split("/")[1];
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="public-website public-website-article">
        <nav className="public-website-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">KovaGPT</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{item.title}</span>
        </nav>
        {showcase && <div className="kova-showcase-progress" aria-hidden="true" />}
        <div className={showcase ? "kova-showcase-hero" : "contents"}>
          <p className="public-article-label">
            {category === "help"
              ? "Help Center"
              : category === "developers"
                ? "Developers"
                : category === "connections"
                  ? "Connections"
                  : "KovaGPT"}
          </p>
          <h1>{item.title}</h1>
          <p className="public-article-lede">{item.description}</p>
          {item.availability && <p className="public-availability">{item.availability}</p>}
          {item.review && <p className="public-availability">{item.review}</p>}
        </div>
        <div className="public-article-body">
          <div>
            {item.sections.map((section, index) => (
              <section
                key={section.title}
                id={`section-${index + 1}`}
                className={showcase ? "kova-showcase-enter" : undefined}
              >
                <h2>{section.title}</h2>
                <p>{section.body}</p>
                {section.points.length > 0 && (
                  <ul>
                    {section.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <aside aria-label="On this page">
            <h2>On this page</h2>
            {item.sections.map((section, index) => (
              <a key={section.title} href={`#section-${index + 1}`}>
                {section.title}
              </a>
            ))}
          </aside>
        </div>
        {item.related.length > 0 && (
          <section aria-label="Continue exploring" className="public-directory-links">
            {item.related.map((related, index) => (
              <Link
                key={related.to}
                to={related.to as never}
                data-public-primary={index === 0 ? "" : undefined}
                className="min-h-11"
              >
                <strong>{related.label}</strong>
                <span>Continue →</span>
              </Link>
            ))}
          </section>
        )}
      </main>
    </PublicShell>
  );
}
