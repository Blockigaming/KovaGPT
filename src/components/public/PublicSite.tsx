import { Link } from "@tanstack/react-router";
import { ArrowRight, Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";

const navigation = [
  { label: "Product", to: "/features" },
  { label: "Use cases", to: "/use-cases" },
  { label: "Developers", to: "/developers" },
  { label: "Trust", to: "/trust" },
  { label: "Pricing", to: "/pricing" },
];

export function PublicSite({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-lg">
        <nav
          className="mx-auto flex min-h-16 max-w-7xl items-center gap-5 px-4 sm:px-6"
          aria-label="Public navigation"
        >
          <Link to="/" className="flex min-h-11 items-center gap-2 font-semibold">
            <NovaLogo mark className="h-7 w-7" />
            KovaGPT
          </Link>
          <div className="ml-auto hidden items-center gap-1 md:flex">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to as never}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <Link
            to="/"
            className="ml-auto hidden min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background md:inline-flex"
          >
            Open KovaGPT
          </Link>
          <button
            type="button"
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg border md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </nav>
        {open ? (
          <div className="border-t px-4 py-3 md:hidden">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to as never}
                className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>
      {children}
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <NovaLogo mark className="h-6 w-6" />
              KovaGPT
            </div>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              An independent AI workspace. Outputs can be wrong; verify important information.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm" aria-label="Footer">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href="/security">Security</a>
            <a href="/accessibility">Accessibility</a>
            <Link to="/help">Help</Link>
            <Link to="/contact-support">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
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
    <PublicSite>
      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
          <p className="text-sm font-semibold text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-.035em] sm:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{summary}</p>
          <Link
            to="/"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background"
          >
            Try KovaGPT <ArrowRight className="h-4 w-4" />
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
    </PublicSite>
  );
}
