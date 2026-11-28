import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PublicPageView } from "@/components/public/PublicSite";
import { PublicWebsiteArticle, websitePageHead } from "@/components/public/PublicWebsiteArticle";
import { filterDeveloperReference } from "@/lib/developer-reference-search.mjs";
import type { DeveloperReferenceEntry } from "@/lib/developer-reference.mjs";

export const Route = createFileRoute("/developers/$docSlug")({
  loader: async ({ params }) => {
    const {
      DEVELOPER_REFERENCE,
      DEVELOPER_ENDPOINTS,
      DEVELOPER_REFERENCE_BY_SLUG,
      developerReferencePage,
    } = await import("@/lib/developer-reference.mjs");
    if (params.docSlug === "docs" || params.docSlug === "api-reference") {
      const reference = params.docSlug === "api-reference";
      return {
        kind: "directory" as const,
        slug: params.docSlug,
        title: reference ? "API reference" : "Developer documentation",
        entries: reference ? DEVELOPER_ENDPOINTS : DEVELOPER_REFERENCE,
      };
    }
    const entry = DEVELOPER_REFERENCE_BY_SLUG.get(params.docSlug);
    if (!entry) throw notFound();
    return { kind: "website" as const, item: developerReferencePage(entry) };
  },
  component: DeveloperDoc,
  head: ({ loaderData: doc }) =>
    doc?.kind === "website"
      ? websitePageHead(doc.item)
      : doc
        ? {
            meta: [
              { title: `${doc.title} | KovaGPT Developers` },
              { name: "description", content: "Search the versioned developer source contracts." },
              { name: "robots", content: "noindex, follow" },
            ],
            links: [{ rel: "canonical", href: `https://kovagpt.com/developers/${doc.slug}` }],
          }
        : {},
});

function DeveloperDirectory({
  title,
  entries,
}: {
  title: string;
  entries: DeveloperReferenceEntry[];
}) {
  const [query, setQuery] = useState("");
  const matches = filterDeveloperReference(entries, query);
  return (
    <PublicPageView
      reference="claude-documentation"
      eyebrow="Developers"
      title={title}
      summary="Preview reference for the versioned API and integration contracts. A documented endpoint is not proof of activation."
    >
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/developers" className="underline">
          Developers
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <nav aria-label="Developer documentation navigation" className="flex flex-wrap gap-4 text-sm">
        <Link to="/developers/$docSlug" params={{ docSlug: "docs" }} className="underline">
          All documentation
        </Link>
        <Link to="/developers/$docSlug" params={{ docSlug: "api-reference" }} className="underline">
          API reference
        </Link>
        <Link to="/developers/$docSlug" params={{ docSlug: "quickstart" }} className="underline">
          Quickstart
        </Link>
        <Link to="/developers/$docSlug" params={{ docSlug: "api-pricing" }} className="underline">
          Pricing
        </Link>
        <a href="/api/developer/openapi" className="underline">
          OpenAPI JSON
        </a>
        <Link to="/developers/console" className="underline">
          Console
        </Link>
      </nav>
      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-6">
        <label className="block space-y-2 text-sm font-medium">
          <span>Search developer documentation</span>
          <input
            type="search"
            aria-controls="developer-search-results"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
            placeholder="Search endpoints, guides and fields"
            className="block min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
          />
        </label>
        <p role="status" className="text-sm text-muted-foreground">
          {matches.length} {matches.length === 1 ? "result" : "results"}
        </p>
        <div id="developer-search-results">
          {matches.length ? (
            <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
              {matches.map((entry) => (
                <li key={entry.slug} className="min-w-0">
                  <Link
                    to="/developers/$docSlug"
                    params={{ docSlug: entry.slug }}
                    className="block min-h-11 rounded-lg border border-border p-4 hover:bg-muted/50"
                  >
                    <h2 className="font-semibold">{entry.title}</h2>
                    {entry.path && (
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {entry.methods?.join(" / ")} {entry.path}
                      </p>
                    )}
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                      {entry.request}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              No matching documentation. Try a route name, field or feature.
            </p>
          )}
        </div>
      </section>
    </PublicPageView>
  );
}

function DeveloperDoc() {
  const doc = Route.useLoaderData();
  if (doc.kind === "website") return <PublicWebsiteArticle item={doc.item} />;
  return <DeveloperDirectory key={doc.slug} title={doc.title} entries={doc.entries} />;
}
