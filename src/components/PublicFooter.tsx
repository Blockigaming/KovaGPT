import "./public/public-website.css";
import { useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";




const PUBLIC_WEBSITE_FOOTER = [
  { label: "KovaGPT", links: [
    { label: "Chat", to: "/" },
    { label: "Plans", to: "/pricing" },
    { label: "Help", to: "/help" },
  ] },
  { label: "Account", links: [
    { label: "Log in", to: "/login" },
    { label: "Sign up", to: "/signup" },
    { label: "Contact support", to: "/contact-support" },
  ] },
  { label: "Legal", links: [
    { label: "Privacy", to: "/privacy" },
    { label: "Terms", to: "/terms" },
    { label: "Refunds", to: "/refund" },
  ] },
] as const;
export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [query, setQuery] = useState("");
  const directory = useMemo(() => {
    const entries = new Map<string, { to: string; label: string }>();
    for (const group of PUBLIC_WEBSITE_FOOTER) {
      for (const link of group.links) entries.set(link.to, link);
    }
    return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, []);
  const matching = directory.filter((entry) =>
    `${entry.label} ${entry.to}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <footer data-ui-reference="claude-public-footer" className="kova-public-footer">
      <div className="kova-footer-inner">
        <div className="kova-footer-content">
          <div className="kova-footer-brand">
            <Link to="/" className="public-website-brand" aria-label="KovaGPT home">
              <NovaLogo decorative mark className="h-6 w-6" />
              <span>KovaGPT</span>
            </Link>
          </div>
          <nav aria-label="Footer navigation" className="kova-footer-nav">
            {PUBLIC_WEBSITE_FOOTER.map((group) => (
              <div key={group.label}>
                <h2>{group.label}</h2>
                <ul>
                  {group.links.map((item) => {
                    const currentPage = pathname === item.to;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to as never}
                          aria-current={currentPage ? "page" : undefined}
                          className="min-h-11"
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
        <details className="kova-footer-directory">
          <summary>Explore all pages</summary>
          <label>
            <span className="sr-only">Search the page directory</span>
            <input
              type="search"
              aria-label="Search the page directory"
              placeholder="Find a page..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav aria-label="All public pages">
            <ul>
              {matching.map((entry) => (
                <li key={entry.to}>
                  <Link to={entry.to as never}>{entry.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          {matching.length === 0 ? <p role="status">No matching pages.</p> : null}
        </details>
        <p className="kova-footer-copyright">
          © {new Date().getFullYear()} KovaGPT is independently developed. AI can make mistakes, and
          some features can depend on plan eligibility and external providers. Third-party names
          belong to their respective owners and do not imply sponsorship, endorsement, or
          affiliation.
        </p>
      </div>
    </footer>
  );
}
