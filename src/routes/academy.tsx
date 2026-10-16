import { ACADEMY_CATEGORIES, academyCategory } from "@/lib/academy-progress.mjs";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { PublicPageView } from "@/components/public/PublicSite";
import { PUBLIC_ACADEMY_PAGES } from "@/lib/public-academy-content";

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
  validateSearch: (search: Record<string, unknown>): { q: string; category: string } => ({
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    category:
      typeof search.category === "string" && ACADEMY_CATEGORIES.includes(search.category)
        ? search.category
        : "all",
  }),
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
  const { q, category } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = q.trim().toLocaleLowerCase();
  const pages = PUBLIC_ACADEMY_PAGES.filter(
    (page) =>
      (category === "all" || academyCategory(page.slug) === category) &&
      [
        page.title,
        page.summary,
        ...page.highlights,
        ...page.sections.flatMap((section) => [
          section.title,
          section.body,
          ...(section.points ?? []),
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
  );
  const search = (value: string) =>
    void navigate({
      search: { q: value.slice(0, 200), category },
      replace: true,
      resetScroll: false,
    });
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
      <section
        className="kova-adapted-controls space-y-3 md:col-span-2"
        aria-label="Academy guides"
      >
        <label htmlFor="academy-category" className="block text-sm font-medium">
          Topic group
        </label>
        <select
          id="academy-category"
          value={category}
          onChange={(event) =>
            void navigate({
              search: { q, category: event.target.value },
              replace: true,
              resetScroll: false,
            })
          }
          className="min-h-11 rounded-xl border bg-background px-3 text-base"
        >
          <option value="all">All topics</option>
          <option value="core">Core skills</option>
          <option value="roles">Roles and teams</option>
          <option value="workflows">Workflows</option>
        </select>
        <label htmlFor="academy-search" className="block text-sm font-medium">
          Search guides
        </label>
        <div className="flex gap-3">
          <input
            id="academy-search"
            type="search"
            maxLength={200}
            value={q}
            onChange={(event) => search(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => search("")}
              className="min-h-11 rounded-xl border border-border px-4"
            >
              Clear search
            </button>
          )}
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {pages.length} of {PUBLIC_ACADEMY_PAGES.length} guides{query ? " match your search" : ""}
        </p>
        {pages.length === 0 && <p>No guides match. Try another term or clear your search.</p>}
      </section>
      {pages.map((page) => (
        <Link
          key={page.slug}
          id={`guide-${page.slug.replaceAll("/", "-")}`}
          search={{ academyQ: q, academyCategory: category } as never}
          to={`/academy/${page.slug}` as never}
          className="group rounded-2xl border border-border bg-background p-6 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">{page.title}</h2>
            <ArrowRight
              className="mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
          <p className="mt-3 leading-7 text-muted-foreground">{page.summary}</p>
        </Link>
      ))}
    </PublicPageView>
  );
}
