import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { type ReactNode } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import type { PublicDetailPage } from "@/lib/public-detail-content";

const DETAIL_SECTION_LANDINGS = new Map<string, { label: string; to: string }>([
  ["form", { label: "contact support", to: "/contact-support" }],
  ["global-affairs", { label: "trust and transparency", to: "/trust-and-transparency" }],
  ["students", { label: "students", to: "/use-cases/students" }],
  ["translate", { label: "translation", to: "/translation" }],
  ["writing", { label: "AI writer", to: "/ai-writer" }],
]);

/**
 * Backwards-compatible public layout name. New public routes should use
 * PublicShell directly when they need a custom main-content layout.
 */
export function PublicSite({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

export function PublicPageView({
  eyebrow,
  title,
  summary,
  children,
  review,
  primaryAction = { label: "Try KovaGPT", to: "/" },
  secondaryAction,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  review?: "legal" | "admin";
  primaryAction?: { label: string; to: string };
  secondaryAction?: { label: string; to: string };
}) {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="min-w-0 [overflow-wrap:anywhere]">
        <section className="relative overflow-hidden border-b border-border/70">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-.04em] text-balance sm:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground text-pretty">
              {summary}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={primaryAction.to as never}
                data-public-primary
                className="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {primaryAction.label} <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
              {secondaryAction ? (
                <Link
                  to={secondaryAction.to as never}
                  className="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full border border-border bg-background/70 px-5 py-2.5 text-center text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {secondaryAction.label}
                </Link>
              ) : null}
            </div>
            {review ? (
              <p className="mt-5 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
                {review === "legal"
                  ? "Draft — legal review required"
                  : "Verified content required before publication"}
              </p>
            ) : null}
          </div>
        </section>
        <section className="bg-muted/25">
          <div className="mx-auto grid max-w-7xl gap-5 px-4 py-14 sm:px-6 sm:py-20 md:grid-cols-2">
            {children}
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

export function PublicDetailPageView({ item }: { item: PublicDetailPage }) {
  const slugSegments = item.slug.split("/");
  const currentPageSlug = slugSegments.at(-1) ?? item.slug;
  const categorySlugs = slugSegments.slice(0, -1);
  const sectionLanding = DETAIL_SECTION_LANDINGS.get(item.section);
  const closing =
    item.closing ??
    ({
      title: "Ready to put it to work?",
      body: "Start with a clear goal, use only the context you need, and verify important output.",
    } as const);
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="min-w-0 [overflow-wrap:anywhere]">
        <section className="relative overflow-hidden border-b border-border/70">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
            >
              <Link
                to={(sectionLanding?.to ?? `/${item.section}`) as never}
                className="rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sectionLanding?.label ?? item.section.replaceAll("-", " ")}
              </Link>
              {categorySlugs.map((category) => (
                <span key={category} className="contents">
                  <span aria-hidden="true">/</span>
                  <span>{category.replaceAll("-", " ")}</span>
                </span>
              ))}
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="min-w-0 text-foreground">
                {currentPageSlug.replaceAll("-", " ")}
              </span>
            </nav>

            <p className="mt-12 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {item.eyebrow}
            </p>
            <h1 className="mt-4 max-w-5xl text-4xl font-semibold tracking-[-.045em] text-balance sm:text-6xl lg:text-7xl">
              {item.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground text-pretty sm:text-xl">
              {item.summary}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to={item.primaryAction.to as never}
                data-public-primary
                className="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {item.primaryAction.label}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
              {item.secondaryAction ? (
                <Link
                  to={item.secondaryAction.to as never}
                  className="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full border border-border bg-background/70 px-5 py-2.5 text-center text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.secondaryAction.label}
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        <section aria-label="Page highlights" className="border-b border-border bg-muted/25">
          <div className="mx-auto grid max-w-7xl gap-px bg-border sm:grid-cols-3">
            {item.highlights.map((highlight) => (
              <div
                key={highlight}
                className="flex min-h-20 items-center gap-3 bg-background px-4 py-5 sm:px-6"
              >
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">{highlight}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-6 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2">
          {item.sections.map((section, index) => (
            <article
              key={section.title}
              className="min-w-0 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-.025em]">{section.title}</h2>
              <p className="mt-4 leading-7 text-muted-foreground">{section.body}</p>
              <ul className="mt-6 space-y-3">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3 text-sm leading-6">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        {item.relatedPages?.length ? (
          <section aria-labelledby="related-pages-heading" className="border-t border-border">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
              <h2 id="related-pages-heading" className="text-3xl font-semibold tracking-[-.03em]">
                Explore the directory
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
                Open an entry to review its current KovaGPT availability and evaluation guidance.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {item.relatedPages.map((page) => (
                  <Link
                    key={page.to}
                    to={page.to as never}
                    className="group min-w-0 rounded-2xl border border-border bg-card p-5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{page.title}</h3>
                      <ArrowRight
                        className="mt-0.5 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{page.summary}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="border-t border-border bg-foreground text-background">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:px-6 sm:py-16 md:flex-row md:flex-wrap md:items-center">
            <div className="min-w-0 md:flex-1 md:basis-64">
              <h2 className="text-2xl font-semibold tracking-[-.025em]">{closing.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-background/70">{closing.body}</p>
            </div>
            <Link
              to={item.primaryAction.to as never}
              className="inline-flex min-h-11 min-w-0 max-w-full shrink-0 items-center justify-center gap-2 rounded-full bg-background px-5 py-2.5 text-center text-sm font-medium text-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground md:max-w-xs"
            >
              {item.primaryAction.label}
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
