import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";

const navigation = [
  { label: "Product", to: "/features" },
  { label: "Use cases", to: "/use-cases" },
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
          ? `flex min-h-11 items-center rounded-xl px-3 text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              currentSection
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`
          : `inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
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
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/80">
      <nav
        className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
        aria-label="Public navigation"
      >
        <Link
          to="/"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg pr-2 font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NovaLogo decorative className="h-7 w-7" />
          <span>KovaGPT</span>
        </Link>

        <div className="ml-auto hidden items-center gap-1 md:flex">
          {navigation.map((item) => (
            <PublicNavigationLink key={item.to} {...item} pathname={pathname} />
          ))}
        </div>

        <Link
          to="/"
          className="ml-1 hidden min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
        >
          Open KovaGPT
        </Link>

        <button
          ref={menuButtonRef}
          type="button"
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:hidden"
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
          className="border-t border-border/70 bg-background pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 shadow-lg md:hidden"
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
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <PublicHeader />
      <div className="flex flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
