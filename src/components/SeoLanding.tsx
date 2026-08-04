import { Link } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";

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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <NovaLogo className="w-6 h-6" />
            <span className="font-semibold">KovaGPT</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link to="/modes" className="hover:underline">
              Modes
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-3xl px-6 py-14 w-full">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">{h1}</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-10">{intro}</p>

        <section className="flex flex-wrap gap-3 mb-12">
          {ctas.map((c, i) => (
            <Link
              key={c.to}
              to={c.to}
              className={
                i === 0
                  ? "text-sm font-medium px-4 py-2 rounded-full bg-foreground text-background hover:opacity-90 transition"
                  : "text-sm font-medium px-4 py-2 rounded-full border border-border hover:bg-accent transition"
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
                  <summary className="cursor-pointer list-none font-medium text-foreground flex items-center justify-between">
                    <span>{f.q}</span>
                    <span className="ml-3 text-muted-foreground transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Link to="/" className="underline hover:text-foreground">
            KovaGPT
          </Link>
          <Link to="/modes" className="underline hover:text-foreground">
            Modes
          </Link>
          <Link to="/images" className="underline hover:text-foreground">
            Images
          </Link>
          <Link to="/pricing" className="underline hover:text-foreground">
            Pricing
          </Link>
          <Link to="/getting-started" className="underline hover:text-foreground">
            Getting Started
          </Link>
        </nav>
      </main>

      <PublicFooter />
    </div>
  );
}
