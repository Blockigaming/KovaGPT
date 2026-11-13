import "./public/public-website.css";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
import { PUBLIC_WEBSITE_FOOTER, PUBLIC_WEBSITE_PAGES } from "@/lib/public-website-catalog.mjs";
import { PUBLIC_SITEMAP_ENTRIES } from "@/lib/seo-policy.mjs";
import { requiresAppAccount } from "@/lib/app-access-policy.mjs";
import { usePhoneLayout } from "@/hooks/use-mobile";

export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [query, setQuery] = useState("");
  const phone = usePhoneLayout();
  const directory = useMemo(() => {
    const entries = new Map(
      PUBLIC_SITEMAP_ENTRIES.filter(({ path }) => path === "/" || !requiresAppAccount(path)).map(
        ({ path }) => [
          path,
          {
            to: path,
            label:
              path === "/"
                ? "KovaGPT"
                : path
                    .split("/")
                    .filter(Boolean)
                    .map((part) => part.replaceAll("-", " "))
                    .join(" / ")
                    .replace(/\b\w/g, (letter) => letter.toUpperCase()),
          },
        ],
      ),
    );
    for (const page of PUBLIC_WEBSITE_PAGES)
      entries.set(page.path, { to: page.path, label: page.title });
    for (const group of PUBLIC_WEBSITE_FOOTER)
      for (const link of group.links) entries.set(link.to, link);
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
            {PUBLIC_WEBSITE_FOOTER.map((group) => {
              const links = group.links.map((item) => {
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
              });
              return (
                <div key={group.label} className="kova-footer-group">
                  {phone ? (
                    <details className="kova-footer-mobile-group">
                      <summary>
                        {group.label}
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <ul>{links}</ul>
                    </details>
                  ) : (
                    <div>
                      <h2>{group.label}</h2>
                      <ul>{links}</ul>
                    </div>
                  )}
                </div>
              );
            })}
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
