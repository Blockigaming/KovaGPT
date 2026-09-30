import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { PublicPageView } from "@/components/public/PublicSite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterAcademyGuides } from "@/lib/public-academy-content";

const academy = {
  title: "KovaGPT Academy",
  eyebrow: "Learning hub",
  description:
    "Build practical AI skills with original KovaGPT guidance and responsible-use boundaries.",
  summary:
    "Start with the product basics, practice on low-risk work, and learn how to verify output before using AI in consequential workflows.",
  sections: [
    {
      title: "Learn by doing",
      body: "Begin with a clear task, provide only necessary context, compare the result with your source material, and revise with specific feedback.",
    },
    {
      title: "Use judgment",
      body: "Treat generated content as a draft. Sensitive, regulated, financial, legal, medical, and safety-critical decisions need qualified review.",
    },
    {
      title: "Respect data boundaries",
      body: "Do not upload secrets or personal information that the task does not require. Follow your organization's approved tools and retention rules.",
    },
  ],
} as const;

export const Route = createFileRoute("/academy")({
  head: () => ({
    meta: [
      { title: `${academy.title} | KovaGPT` },
      { name: "description", content: academy.description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: `${academy.title} | KovaGPT` },
      { property: "og:description", content: academy.description },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/writer.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/academy" }],
  }),
  component: AcademyPage,
});

function AcademyPage() {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const guides = filterAcademyGuides(query);
  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  return (
    <PublicPageView
      eyebrow={academy.eyebrow}
      title={academy.title}
      summary={academy.summary}
      primaryAction={{ label: "Start Academy guides", to: "/academy/ai-fundamentals" }}
    >
      {academy.sections.map((section) => (
        <article key={section.title} className="rounded-2xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
        </article>
      ))}
      <section aria-labelledby="academy-guides-heading" className="min-w-0 md:col-span-2">
        <h2 id="academy-guides-heading" className="text-2xl font-semibold">
          Academy guides
        </h2>
        <form
          role="search"
          aria-label="Academy guides"
          className="mt-5 max-w-xl"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="academy-search" className="text-sm font-medium">
            Search guides
          </label>
          <div className="relative mt-2">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              id="academy-search"
              type="search"
              autoComplete="off"
              value={query}
              placeholder="Search Academy guides"
              aria-controls="academy-guide-results"
              aria-describedby="academy-search-hint academy-result-count"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  clearSearch();
                }
              }}
              className="h-14 rounded-2xl border-border bg-background pl-12 pr-14 text-base focus-visible:ring-2 focus-visible:ring-ring md:text-base [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear Academy search"
                onClick={clearSearch}
                className="absolute right-1 top-1/2 h-11 w-11 -translate-y-1/2 rounded-xl"
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <p id="academy-search-hint" className="mt-2 text-sm text-muted-foreground">
            Search guide titles and summaries. Press Escape to clear.
          </p>
        </form>
        <p
          id="academy-result-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-5 text-sm text-muted-foreground"
        >
          {guides.length} {guides.length === 1 ? "guide" : "guides"} found
        </p>
        <div id="academy-guide-results" className="mt-4 grid min-w-0 gap-5 md:grid-cols-2">
          {guides.length ? (
            guides.map((page) => (
              <Link
                key={page.slug}
                to={`/academy/${page.slug}` as never}
                className="group min-w-0 rounded-2xl border border-border bg-background p-6 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-xl font-semibold">{page.title}</h3>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 leading-7 text-muted-foreground">{page.summary}</p>
              </Link>
            ))
          ) : (
            <div className="min-w-0 rounded-2xl border border-dashed border-border bg-background p-6 md:col-span-2">
              <h3 className="text-xl font-semibold">No guides found</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Try different keywords or clear your search to browse all guides.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-5 min-h-11 max-w-full whitespace-normal text-center"
                onClick={clearSearch}
              >
                Clear search
              </Button>
            </div>
          )}
        </div>
      </section>
    </PublicPageView>
  );
}
