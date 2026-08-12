import { Link } from "@tanstack/react-router";
import { NovaLogo } from "./NovaLogo";
import { PublicFooter } from "./PublicFooter";
import type { PublicPage } from "@/content/public-pages";

export function PublicPageTemplate({ page }: { page: PublicPage }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:m-3 focus:rounded-md focus:bg-background focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b border-border/70">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:flex-nowrap">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <NovaLogo className="size-7" />
            KovaGPT
          </Link>
          <nav
            aria-label="Primary"
            className="flex w-full items-center justify-between gap-3 text-sm sm:w-auto sm:justify-start sm:gap-4"
          >
            <Link to="/features">Features</Link>
            <Link to="/developers">Developers</Link>
            <Link to="/pricing">Pricing</Link>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[.18em] text-primary">
            {page.eyebrow}
          </p>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            {page.title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{page.summary}</p>
          {page.cta && (
            <a
              href={page.cta.href}
              className="mt-8 inline-flex min-h-11 items-center rounded-full bg-foreground px-6 font-medium text-background"
            >
              {page.cta.label}
            </a>
          )}
        </section>
        <section className="border-y border-border/70 bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 md:grid-cols-2">
            {page.sections.map((section) => (
              <article
                key={section.heading}
                className="rounded-3xl border border-border bg-card p-7 shadow-sm"
              >
                <h2 className="text-xl font-semibold">{section.heading}</h2>
                <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
              </article>
            ))}
          </div>
        </section>
        {page.review && (
          <aside
            className="mx-auto max-w-6xl px-5 py-10 text-sm text-muted-foreground"
            aria-label="Review notice"
          >
            <strong className="text-foreground">Review notice:</strong>{" "}
            {page.review === "legal"
              ? "This information is a plain-language draft and requires professional legal review before production reliance."
              : "Details are intentionally withheld until an administrator verifies them."}
          </aside>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
