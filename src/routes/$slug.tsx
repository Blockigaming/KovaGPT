import { createFileRoute, notFound, Link, redirect } from "@tanstack/react-router";
import { PUBLIC_PAGE_BY_SLUG } from "@/lib/public-content";
import { PUBLICATIONS, PUBLICATION_SECTIONS } from "@/lib/publications";
import { PublicPageView, PublicSite } from "@/components/public/PublicSite";
import { ProductOverview } from "@/components/public/ProductOverview";
import { isReservedPublicPath } from "@/lib/public-route-policy.mjs";
import { isPublicIndexableRoute } from "@/lib/seo-policy.mjs";
import {
  resolveSourceLocale,
  RTL_LOCALES,
  SOURCE_LOCALE_PATHS,
  translations,
  type SupportedLocale,
} from "@/lib/locales";
import { ArrowRight } from "lucide-react";

const PAGE_ACTIONS = new Map([
  ["overview", { primaryAction: { label: "Open KovaGPT", to: "/" } }],
  ["college-students", { primaryAction: { label: "Open Study", to: "/study" } }],
  ["parent-resources", { primaryAction: { label: "Explore family guidance", to: "/families" } }],
  ["health", { primaryAction: { label: "Open KovaGPT", to: "/" } }],
  ["contact-sales", { primaryAction: { label: "Contact support", to: "/contact-support" } }],
  ["shopping", { primaryAction: { label: "Start shopping research", to: "/" } }],
  ["business-data", { primaryAction: { label: "Review data controls", to: "/data-controls" } }],
  ["careers", { primaryAction: { label: "Contact KovaGPT", to: "/contact-support" } }],
  ["charter", { primaryAction: { label: "About KovaGPT", to: "/about" } }],
  ["consumer-privacy", { primaryAction: { label: "Review data controls", to: "/data-controls" } }],
  [
    "economic-research-exchange",
    { primaryAction: { label: "Explore KovaGPT research", to: "/research-assistant" } },
  ],
  [
    "enterprise-privacy",
    { primaryAction: { label: "Evaluate enterprise use", to: "/business/enterprise" } },
  ],
  ["interview-guide", { primaryAction: { label: "View careers status", to: "/careers" } }],
  ["open-model-feedback", { primaryAction: { label: "Contact support", to: "/contact-support" } }],
  ["open-models", { primaryAction: { label: "Review model guidance", to: "/developers/models" } }],
  ["our-structure", { primaryAction: { label: "About KovaGPT", to: "/about" } }],
  [
    "policies",
    {
      primaryAction: { label: "Read terms", to: "/terms" },
      secondaryAction: { label: "Read privacy information", to: "/privacy" },
    },
  ],
  ["residency", { primaryAction: { label: "View careers status", to: "/careers" } }],
  ["safety", { primaryAction: { label: "Review AI safety", to: "/ai-safety" } }],
  ["science", { primaryAction: { label: "Open research tools", to: "/research-assistant" } }],
  ["security-and-privacy", { primaryAction: { label: "Review security", to: "/security" } }],
  ["solutions", { primaryAction: { label: "Explore business use", to: "/business" } }],
  [
    "student-collective",
    { primaryAction: { label: "Explore student guidance", to: "/college-students" } },
  ],
  [
    "transparency-and-content-moderation",
    { primaryAction: { label: "Review moderation", to: "/moderation" } },
  ],
  ["trust-and-transparency", { primaryAction: { label: "Open the trust center", to: "/trust" } }],
]);

const RELATED_PAGES = new Map<string, readonly { title: string; summary: string; to: string }[]>([
  [
    "features",
    [
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
  loader: async ({ params }) => {
    if (params.slug === "scheduled") throw redirect({ to: "/scheduled-tasks", replace: true });
    if (isReservedPublicPath(`/${params.slug}`)) throw notFound();
    const locale = resolveSourceLocale(params.slug);
    if (locale)
      return {
        kind: "locale" as const,
        routeLocale: params.slug,
        locale,
        copy: translations[locale],
      };
    let item = PUBLIC_PAGE_BY_SLUG.get(params.slug);
    if (!item) {
      const { EXPANDED_PUBLIC_PAGE_BY_SLUG } = await import("@/lib/public-content-expanded");
      item = EXPANDED_PUBLIC_PAGE_BY_SLUG.get(params.slug);
    }
    if (item?.review) throw notFound();
    if (item) return { kind: "page" as const, item, related: RELATED_PAGES.get(item.slug) ?? [] };
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
    if (data.kind === "locale")
      return {
        meta: [
          { title: `${data.copy.title} | KovaGPT` },
          { name: "description", content: data.copy.description },
          { name: "robots", content: "noindex, follow" },
        ],
        links: [
          { rel: "canonical", href: `https://kovagpt.com/${data.routeLocale}` },
          ...SOURCE_LOCALE_PATHS.map(({ path }) => ({
            rel: "alternate",
            hrefLang: path,
            href: `https://kovagpt.com/${path}`,
          })),
          { rel: "alternate", hrefLang: "x-default", href: "https://kovagpt.com/" },
        ],
      };
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
  if (data.kind === "locale")
    return (
      <SourceLocaleHome routeLocale={data.routeLocale} locale={data.locale} copy={data.copy} />
    );
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
  if (item.slug === "overview") return <ProductOverview />;
  const actions = PAGE_ACTIONS.get(item.slug);
  const related = data.related;
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

function SourceLocaleHome({
  routeLocale,
  locale,
  copy,
}: {
  routeLocale: string;
  locale: SupportedLocale;
  copy: (typeof translations)[SupportedLocale];
}) {
  const direction = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  return (
    <PublicSite>
      <main
        id="main-content"
        lang={routeLocale}
        dir={direction}
        className="mx-auto flex min-h-[70vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6"
        tabIndex={-1}
      >
        <p className="font-semibold text-muted-foreground">{copy.product}</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
          {copy.title}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{copy.description}</p>
        <Link
          to="/"
          data-public-primary
          className="mt-8 inline-flex min-h-11 w-fit items-center rounded-full bg-foreground px-5 text-background"
        >
          {copy.open}
        </Link>
        <label className="mt-10 w-fit text-sm">
          <span lang="en" className="sr-only">
            Language
          </span>
          <select
            value={routeLocale}
            onChange={(event) => location.assign(`/${event.target.value}`)}
            className="min-h-11 rounded-lg border bg-background px-3"
          >
            {SOURCE_LOCALE_PATHS.map(({ path }) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
      </main>
    </PublicSite>
  );
}
