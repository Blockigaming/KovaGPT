import "./public-foundation.css";
import "./spec400-public.css";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { PublicFooter } from "@/components/PublicFooter";
import { Button } from "@/components/ui/button";
import { requestDrawerNavigationFocus } from "@/lib/drawer-navigation-focus";

const navigation = [
  { label: "About", to: "/overview" },
  { label: "Features", to: "/features" },
  { label: "Learn", to: "/use-cases" },
  { label: "Business", to: "/business" },
  { label: "Pricing", to: "/pricing" },
  { label: "Download", to: "/download" },
  { label: "Review", to: "/review" },
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
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
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
                ? "bg-muted text-foreground"
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

  const closeAfterMobileNavigation = (
    event: MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== "_self") ||
      event.currentTarget.hasAttribute("download")
    )
      return;
    // Root ownership survives this page's header unmount and waits for the
    // destination render; later navigation or interaction cancels the intent.
    requestDrawerNavigationFocus({
      destination,
      source: event.currentTarget.closest<HTMLElement>("#public-mobile-navigation"),
    });
    setOpen(false);
  };

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
    <header
      data-ui-reference="grok-public-navigation"
      className="kova-public-header sticky top-0 z-40 flex max-h-screen min-w-0 flex-col border-b border-border bg-background pt-[env(safe-area-inset-top)] [overflow-wrap:anywhere] supports-[height:100dvh]:max-h-dvh"
    >
      <nav
        className="mx-auto flex min-h-16 w-full min-w-0 max-w-7xl shrink-0 flex-wrap items-center gap-2 sm:gap-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
        aria-label="Public navigation"
      >
        <Link
          to="/"
          className="flex min-h-11 min-w-0 max-w-full shrink-0 items-center gap-2 rounded-lg pr-2 font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <NovaLogo decorative className="h-6 w-6" />
          <span className="min-w-0">KovaGPT</span>
        </Link>

        <div className="ml-auto hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-1 lg:flex">
          {navigation.map((item) => (
            <PublicNavigationLink key={item.to} {...item} pathname={pathname} />
          ))}
        </div>

        <Button
          asChild
          className="ml-1 hidden h-auto min-h-9 min-w-0 max-w-full whitespace-normal text-center lg:inline-flex"
        >
          <Link to="/">Open KovaGPT</Link>
        </Button>

        <Button
          ref={menuButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto lg:hidden"
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
        </Button>
      </nav>

      {open ? (
        <nav
          id="public-mobile-navigation"
          tabIndex={-1}
          className="min-h-0 overflow-y-auto overscroll-contain border-t border-border bg-background pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 lg:hidden"
          aria-label="Mobile public navigation"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {navigation.map((item) => (
              <PublicNavigationLink
                key={item.to}
                {...item}
                pathname={pathname}
                mobile
                onNavigate={(event) => closeAfterMobileNavigation(event, item.to)}
              />
            ))}
            <Button
              asChild
              className="mt-2 h-auto min-h-9 min-w-0 max-w-full whitespace-normal text-center"
            >
              <Link to="/" onClick={(event) => closeAfterMobileNavigation(event, "/")}>
                Open KovaGPT
              </Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const root = shellRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const renderProgress = () => {
      frame = 0;
      const total = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / total));
      root.style.setProperty("--kova-page-progress", String(progress));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(renderProgress);
    };
    const animated = Array.from(
      root.querySelectorAll<HTMLElement>(
        "main > section, main > article, main article > section, .public-use-case, .public-plan-card, .public-section-heading, .public-workflow-example",
      ),
    ).slice(0, 100);
    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries, current) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                (entry.target as HTMLElement).setAttribute("data-kova-revealed", "true");
                current.unobserve(entry.target);
              }
            },
            { threshold: 0.07, rootMargin: "0px 0px -20px 0px" },
          )
        : null;
    for (const item of animated) {
      if (observer) observer.observe(item);
      else item.setAttribute("data-kova-revealed", "true");
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        ".public-use-case, .public-plan-card, .public-workflow-example, .kova-public-interactive",
      );
      if (!target || !root.contains(target)) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--kova-pointer-x", event.clientX - rect.left + "px");
      target.style.setProperty("--kova-pointer-y", event.clientY - rect.top + "px");
    };
    renderProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    root.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.removeEventListener("pointermove", onPointerMove);
      root.style.removeProperty("--kova-page-progress");
    };
  }, [pathname]);
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
      data-ui-reference="grok-public-shell"
      data-ui="modern"
      className="flex min-h-[100dvh] min-w-0 flex-col bg-background text-foreground"
    >
      <PublicHeader />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
