import { createFileRoute, notFound, Link, redirect } from "@tanstack/react-router";
import { PUBLIC_PAGE_BY_SLUG } from "@/lib/public-content";
import { PUBLICATIONS, PUBLICATION_SECTIONS } from "@/lib/publications";
import { PublicPageView } from "@/components/public/PublicSite";
import { isReservedPublicPath } from "@/lib/public-route-policy.mjs";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";
import { ArrowRight } from "lucide-react";

const PAGE_ACTIONS = new Map([
  ["overview", { primaryAction: { label: "Open KovaGPT", to: "/" } }],
  ["college-students", { primaryAction: { label: "Open Study", to: "/study" } }],
  ["parent-resources", { primaryAction: { label: "Explore family guidance", to: "/families" } }],
  ["health", { primaryAction: { label: "Open KovaGPT", to: "/" } }],
  ["contact-sales", { primaryAction: { label: "Contact support", to: "/contact-support" } }],
  ["shopping", { primaryAction: { label: "Start shopping research", to: "/" } }],
]);

const RELATED_PAGES = new Map<string, readonly { title: string; summary: string; to: string }[]>([
  [
    "features",
    [
      {
        title: "Deep Research",
        summary: "Plan and produce source-backed reports.",
        to: "/features/deep-research",
      },
      {
        title: "Apps",
        summary: "Connect supported services with explicit permissions.",
        to: "/features/plugins",
      },
      {
        title: "Study",
        summary: "Learn through explanations and guided practice.",
        to: "/features/study-mode",
      },
      {
        title: "Documents",
        summary: "Ask focused questions against supported files.",
        to: "/features/chat-with-pdfs",
      },
    ],
  ],
  [
    "plans",
    [
      { title: "Free", summary: "Core chat with published daily allowances.", to: "/plans/free" },
      {
        title: "Plus",
        summary: "Higher allowances and advanced supported tools.",
        to: "/plans/plus",
      },
      {
        title: "Pro",
        summary: "Highest published allowances and reasoning modes.",
        to: "/plans/pro",
      },
    ],
  ],
  [
    "use-cases",
    [
      {
        title: "Presentations",
        summary: "Plan, review, and refine a clear narrative.",
        to: "/use-cases/chat-with-presentations",
      },
      {
        title: "Spreadsheets",
        summary: "Reason about structured data and calculations.",
        to: "/use-cases/chat-with-spreadsheets",
      },
      {
        title: "Health",
        summary: "Organize general information with safety boundaries.",
        to: "/use-cases/fitness-wellness-and-health",
      },
      {
        title: "Money",
        summary: "Structure comparisons without individualized advice.",
        to: "/use-cases/money-and-finances",
      },
      {
        title: "Cooking",
        summary: "Plan and adapt recipes with food safety in view.",
        to: "/use-cases/recipes-cooking",
      },
      {
        title: "Science and medicine",
        summary: "Explore evidence with uncertainty visible.",
        to: "/use-cases/science-medicine",
      },
      {
        title: "Students",
        summary: "Support learning and academic integrity.",
        to: "/use-cases/students",
      },
      {
        title: "Teachers",
        summary: "Draft learning materials with educator review.",
        to: "/use-cases/teachers",
      },
      {
        title: "Travel",
        summary: "Plan options and verify live details directly.",
        to: "/use-cases/travel-and-exploration",
      },
      {
        title: "University educators",
        summary: "Support course and research workflows.",
        to: "/use-cases/university-educators",
      },
      {
        title: "Veterans",
        summary: "Organize questions around official resources.",
        to: "/use-cases/veterans",
      },
    ],
  ],
  [
    "business",
    [
      {
        title: "Data and analytics",
        summary: "Build reproducible, reviewable analysis workflows.",
        to: "/business/ai-for-data-science-analytics",
      },
      {
        title: "Engineering",
        summary: "Support code and planning with tests in control.",
        to: "/business/ai-for-engineering",
      },
      {
        title: "Finance",
        summary: "Preserve calculation and approval controls.",
        to: "/business/ai-for-finance",
      },
      {
        title: "Product",
        summary: "Connect synthesis to evidence and decisions.",
        to: "/business/ai-for-product-management",
      },
      {
        title: "Sales and marketing",
        summary: "Draft with claim, consent, and brand review.",
        to: "/business/ai-for-sales-marketing",
      },
      {
        title: "Education",
        summary: "Evaluate privacy, pedagogy, and access needs.",
        to: "/business/education",
      },
      {
        title: "Enterprise",
        summary: "Scope identity, security, retention, and support.",
        to: "/business/enterprise",
      },
    ],
  ],
  [
    "education",
    [
      {
        title: "College students",
        summary: "Learn actively while following course rules.",
        to: "/college-students",
      },
      {
        title: "Students",
        summary: "Use explanations, planning, and guided practice.",
        to: "/use-cases/students",
      },
      {
        title: "Teachers",
        summary: "Create reviewable learning materials.",
        to: "/use-cases/teachers",
      },
      {
        title: "University educators",
        summary: "Support course and research workflows.",
        to: "/use-cases/university-educators",
      },
    ],
  ],
  [
    "families",
    [
      {
        title: "Parent resources",
        summary: "Discuss privacy, safety, limits, and verification.",
        to: "/parent-resources",
      },
      {
        title: "Data controls",
        summary: "Understand history, memory, export, and deletion.",
        to: "/data-controls",
      },
    ],
  ],
]);

const label = (value: string) =>
  value
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => {
    if (params.slug === "scheduled") throw redirect({ to: "/scheduled-tasks", replace: true });
    if (isReservedPublicPath(`/${params.slug}`)) throw notFound();
    const item = PUBLIC_PAGE_BY_SLUG.get(params.slug);
    if (item?.review) throw notFound();
    if (item) return { kind: "page" as const, item };
    if ((PUBLICATION_SECTIONS as readonly string[]).includes(params.slug))
      return {
        kind: "index" as const,
        section: params.slug,
        items: PUBLICATIONS.filter((item) => item.section === params.slug),
      };
    throw notFound();
  },
  head: ({ loaderData: data }) => {
    if (!data) return {};
    if (data.kind === "page")
      return {
        meta: [
          { title: `${data.item.title} | KovaGPT` },
          { name: "description", content: data.item.description },
          {
            name: "robots",
            content: isPublicIndexableRoute(`/${data.item.slug}`)
              ? "index, follow"
              : "noindex, follow",
          },
          { property: "og:title", content: `${data.item.title} | KovaGPT` },
          { property: "og:description", content: data.item.description },
          { property: "og:type", content: "website" },
          { property: "og:image", content: "https://kovagpt.com/og/writer.jpg" },
        ],
        links: [{ rel: "canonical", href: `https://kovagpt.com/${data.item.slug}` }],
      };
    return {
      meta: [
        { title: `${label(data.section)} | KovaGPT` },
        {
          name: "description",
          content: `Original KovaGPT ${label(data.section).toLowerCase()} and updates.`,
        },
        { name: "robots", content: "noindex, follow" },
      ],
      links: [{ rel: "canonical", href: `https://kovagpt.com/${data.section}` }],
    };
  },
  component: Page,
});
function Page() {
  const data = Route.useLoaderData();
  if (data.kind === "index")
    return (
      <PublicPageView
        eyebrow="Publishing"
        title={label(data.section)}
        summary={`Original KovaGPT ${label(data.section).toLowerCase()}, maintained as structured content.`}
      >
        {data.items.length ? (
          data.items.map((item) => (
            <Link
              key={item.slug}
              to={`/${item.section}/${item.slug}` as never}
              className="rounded-2xl border bg-background p-6 hover:bg-muted"
            >
              <p className="text-xs text-muted-foreground">{item.publishedAt}</p>
              <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
              <p className="mt-3 text-muted-foreground">{item.description}</p>
            </Link>
          ))
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed p-8 text-center">
            <h2 className="font-semibold">No published entries yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Drafts and unapproved content are not public.
            </p>
          </div>
        )}
      </PublicPageView>
    );
  const item = data.item;
  const actions = PAGE_ACTIONS.get(item.slug);
  const related = RELATED_PAGES.get(item.slug) ?? [];
  return (
    <PublicPageView
      eyebrow={item.eyebrow}
      title={item.title}
      summary={item.summary}
      review={item.review}
      {...actions}
    >
      {item.sections.map((section) => (
        <article key={section.title} className="rounded-2xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
        </article>
      ))}
      {related.map((page) => (
        <Link
          key={page.to}
          to={page.to as never}
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
