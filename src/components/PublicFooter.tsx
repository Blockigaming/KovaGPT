import { Link } from "@tanstack/react-router";
import { NovaLogo } from "@/components/NovaLogo";

export function PublicFooter() {
  return (
    <footer className="border-t border-border px-5 py-6 text-sm text-muted-foreground">
      <nav aria-label="Account and legal links" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3">
        <Link to="/" className="inline-flex items-center gap-2 font-medium text-foreground">
          <NovaLogo decorative mark className="h-5 w-5" /> KovaGPT
        </Link>
        <Link to="/pricing">Plans and billing</Link>
        <Link to="/help">Help</Link>
        <Link to="/contact-support">Contact support</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/refund">Refunds</Link>
      </nav>
    </footer>
  );
}
