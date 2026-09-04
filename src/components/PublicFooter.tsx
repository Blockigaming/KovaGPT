import { Link, useRouterState } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";

const footerLinks = [
  { label: "Privacy", to: "/privacy" },
  { label: "Terms", to: "/terms" },
  { label: "Security", to: "/security" },
  { label: "Accessibility", to: "/accessibility" },
  { label: "Help", to: "/help" },
  { label: "Contact", to: "/contact-support" },
] as const;

export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <footer className="border-t border-border bg-muted/20">
      <div className="mx-auto grid max-w-7xl gap-8 py-10 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex items-center gap-2 font-semibold tracking-[-0.01em]">
            <NovaLogo decorative mark className="h-6 w-6" />
            <span>KovaGPT</span>
          </div>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            KovaGPT is independently developed. AI can make mistakes, and some features can depend
            on plan eligibility and external providers. Verify important information.
          </p>
          <p className="mt-3 max-w-xl text-xs leading-5 text-muted-foreground">
            Third-party product names used in editorial comparisons belong to their respective
            owners and do not imply sponsorship, endorsement, or affiliation.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} KovaGPT</p>
        </div>

        <nav
          className="grid grid-cols-2 gap-x-8 text-sm sm:grid-cols-3"
          aria-label="Footer navigation"
        >
          {footerLinks.map((item) => {
            const currentPage = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                aria-current={currentPage ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </footer>
  );
}
