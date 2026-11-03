import "./public/public-website.css";
import { Link, useRouterState } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";
import { PUBLIC_WEBSITE_FOOTER } from "@/lib/public-website-catalog.mjs";

export function PublicFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
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
