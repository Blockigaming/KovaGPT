import { Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export type SeoLandingCta = { label: string; to: string };
export type SeoFaq = { q: string; a: string };

export type SeoLandingProps = {
  h1: string;
  intro: string;
  benefits: string[];
  prompts: string[];
  ctas: SeoLandingCta[];
  details?: string[];
  faq?: SeoFaq[];
};

export function SeoLanding({ h1, intro, benefits, prompts, ctas, details, faq }: SeoLandingProps) {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto min-w-0 w-full max-w-3xl flex-1 px-6 py-14 [overflow-wrap:anywhere]"
      >
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">{h1}</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-10">{intro}</p>

        <section className="flex flex-wrap gap-3 mb-12">
          {ctas.map((c, i) => (
            <Link
              key={c.to}
              to={c.to}
              className={
                i === 0
                  ? "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full text-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                  : "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full text-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
              }
            >
              {c.label}
            </Link>
          ))}
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3">What you can do</h2>
          <ul className="space-y-2 text-sm sm:text-base text-muted-foreground">
            {benefits.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        {details && details.length > 0 && (
          <section className="mb-12 space-y-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
            <h2 className="text-xl font-semibold text-foreground mb-2">How it works</h2>
            {details.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </section>
        )}

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3">Example prompts</h2>
          <ul className="space-y-2 text-sm sm:text-base text-muted-foreground">
            {prompts.map((p) => (
              <li key={p} className="rounded-lg border border-border bg-card px-3 py-2">
                {p}
              </li>
            ))}
          </ul>
        </section>

        {faq && faq.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-3">Frequently asked questions</h2>
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {faq.map((f) => (
                <details key={f.q} className="group px-4 py-3">
                  <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-sm py-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0">{f.q}</span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition group-open:rotate-45 motion-reduce:transition-none"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <nav
          aria-label="Related pages"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
        >
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-sm py-2.5 underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            KovaGPT
          </Link>
          <Link
            to="/modes"
            className="inline-flex min-h-11 items-center rounded-sm py-2.5 underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Modes
          </Link>
          <Link
            to="/images"
            className="inline-flex min-h-11 items-center rounded-sm py-2.5 underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Images
          </Link>
          <Link
            to="/pricing"
            className="inline-flex min-h-11 items-center rounded-sm py-2.5 underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Pricing
          </Link>
          <Link
            to="/getting-started"
            className="inline-flex min-h-11 items-center rounded-sm py-2.5 underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Getting Started
          </Link>
        </nav>
      </main>
    </PublicShell>
  );
}
