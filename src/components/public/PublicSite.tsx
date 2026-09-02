import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type ReactNode } from "react";
import { PublicShell } from "@/components/public/PublicShell";

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
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  review?: "legal" | "admin";
}) {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
          <p className="text-sm font-semibold text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-.035em] sm:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{summary}</p>
          <Link
            to="/"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Try KovaGPT <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {review ? (
            <p className="mt-5 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
              {review === "legal"
                ? "Draft — legal review required"
                : "Verified content required before publication"}
            </p>
          ) : null}
        </section>
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto grid max-w-7xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-2">
            {children}
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
