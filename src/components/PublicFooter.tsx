import "./public/public-website.css";
import { useId, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import {
  PUBLIC_WEBSITE_FOOTER,
  PUBLIC_WEBSITE_ROUTE_INDEX,
} from "@/lib/public-website-route-index.mjs";
import { PUBLIC_SITEMAP_ENTRIES } from "@/lib/seo-policy.mjs";
import { requiresAppAccount } from "@/lib/app-access-policy.mjs";

export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [query, setQuery] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const groupId = useId();
  const directory = useMemo(() => {
    if (!directoryOpen) return [];
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
    for (const page of PUBLIC_WEBSITE_ROUTE_INDEX)
      entries.set(page.path, { to: page.path, label: page.title });
    for (const group of PUBLIC_WEBSITE_FOOTER)
      for (const link of group.links) entries.set(link.to, link);
    return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directoryOpen]);
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
            {PUBLIC_WEBSITE_FOOTER.map((group, index) => {
              const expanded = expandedGroup === group.label;
              const linksId = `${groupId}-${index}`;
              return (
                <div key={group.label} data-expanded={expanded}>
                  <h2>
                    <span className="kova-footer-group-title">{group.label}</span>
                    <button
                      className="kova-footer-group-toggle"
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={linksId}
                      onClick={() => setExpandedGroup(expanded ? null : group.label)}
                    >
                      {group.label}
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  </h2>
                  <ul id={linksId}>
                    {group.links.map((item) => (
                      <li key={item.to}>
                        <Link
                          to={item.to as never}
                          aria-current={pathname === item.to ? "page" : undefined}
                          className="min-h-11"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </div>
        <details
          className="kova-footer-directory"
          onToggle={(event) => setDirectoryOpen(event.currentTarget.open)}
        >
          <summary>Explore all pages</summary>
          {directoryOpen ? (
            <>
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
            </>
          ) : null}
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
