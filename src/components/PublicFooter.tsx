import { Link, useRouterState } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";

const footerGroups = [
  {
    label: "Product",
    links: [
      { label: "Overview", to: "/overview" },
      { label: "Features", to: "/features" },
      { label: "Plans", to: "/pricing" },
      { label: "Apps", to: "/apps" },
    ],
  },
  {
    label: "Workflows",
    links: [
      { label: "Use cases", to: "/use-cases" },
      { label: "Business", to: "/business" },
      { label: "Education", to: "/education" },
      { label: "Developers", to: "/developers" },
    ],
  },
  {
    label: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Trust", to: "/trust" },
      { label: "Status", to: "/status" },
      { label: "Help", to: "/help" },
      { label: "Contact", to: "/contact-support" },
    ],
  },
  {
    label: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Security", to: "/security" },
      { label: "Accessibility", to: "/accessibility" },
    ],
  },
] as const;

export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <footer className="min-w-0 border-t border-border bg-muted/20 [overflow-wrap:anywhere]">
      <div className="mx-auto grid max-w-7xl gap-10 py-12 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
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
          className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-8 text-sm"
          aria-label="Footer navigation"
        >
          {footerGroups.map((group) => (
            <div key={group.label} className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                {group.label}
              </h2>
              <ul className="mt-3">
                {group.links.map((item) => {
                  const currentPage = pathname === item.to;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to as never}
                        aria-current={currentPage ? "page" : undefined}
                        className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-sm py-2.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
