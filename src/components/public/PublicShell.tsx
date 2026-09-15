import "./public-foundation.css";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";

const navigation = [
  { label: "Product", to: "/features" },
  { label: "Use cases", to: "/use-cases" },
  { label: "Business", to: "/business" },
  { label: "Developers", to: "/developers" },
  { label: "Trust", to: "/trust" },
  { label: "Pricing", to: "/pricing" },
] as const;

function isCurrentPath(pathname: string, to: string) {
  return pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
}

function PublicNavigationLink({
  label,
  to,
  pathname,
  mobile = false,
  onNavigate,
}: {
  label: string;
  to: string;
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const currentPage = pathname === to;
  const currentSection = isCurrentPath(pathname, to);

  return (
    <Link
      to={to as never}
      aria-current={currentPage ? "page" : undefined}
      onClick={onNavigate}
      className={
        mobile
          ? `flex min-h-11 min-w-0 max-w-full items-center rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              currentSection
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`
          : `inline-flex min-h-11 min-w-0 max-w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              currentSection
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`
      }
    >
      {label}
    </Link>
  );
}

export function PublicHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 flex max-h-screen min-w-0 flex-col border-b border-border/70 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl [overflow-wrap:anywhere] supports-[height:100dvh]:max-h-dvh supports-[backdrop-filter]:bg-background/80">
      <nav
        className="mx-auto flex min-h-16 w-full min-w-0 max-w-7xl shrink-0 flex-wrap items-center gap-2 sm:gap-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
        aria-label="Public navigation"
      >
        <Link
          to="/"
          className="flex min-h-11 min-w-0 max-w-full shrink-0 items-center gap-2 rounded-lg pr-2 font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NovaLogo decorative className="h-7 w-7" />
          <span className="min-w-0">KovaGPT</span>
        </Link>

        <div className="ml-auto hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-1 lg:flex">
          {navigation.map((item) => (
            <PublicNavigationLink key={item.to} {...item} pathname={pathname} />
          ))}
        </div>

        <Link
          to="/"
          className="ml-1 hidden min-h-11 min-w-0 max-w-full items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:inline-flex"
        >
          Open KovaGPT
        </Link>

        <button
          ref={menuButtonRef}
          type="button"
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-controls="public-mobile-navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </nav>

      {open ? (
        <nav
          id="public-mobile-navigation"
          tabIndex={-1}
          className="min-h-0 overflow-y-auto overscroll-contain border-t border-border/70 bg-background pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 shadow-lg lg:hidden"
          aria-label="Mobile public navigation"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {navigation.map((item) => (
              <PublicNavigationLink
                key={item.to}
                {...item}
                pathname={pathname}
                mobile
                onNavigate={() => setOpen(false)}
              />
            ))}
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Open KovaGPT
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = shellRef.current;
    const header = shell?.querySelector("header");
    if (!shell || !header) return;
    const update = () =>
      shell.style.setProperty(
        "--kova-public-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    update();
    // Account for menu opening, wrapped navigation, text zoom and safe areas.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(header);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return (
    <div
      ref={shellRef}
      data-public-shell
      className="flex min-h-[100dvh] min-w-0 flex-col bg-background text-foreground"
    >
      <PublicHeader />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
