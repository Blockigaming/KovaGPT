import { Link } from "@tanstack/react-router";

export function PublicFooter() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground space-y-4">
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/getting-started" className="hover:text-foreground">
            Getting Started
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/refund" className="hover:text-foreground">
            Refund Policy
          </Link>
          <Link to="/contact-support" className="hover:text-foreground">
            Contact Support
          </Link>
          <Link to="/ai-safety" className="hover:text-foreground">
            AI Safety
          </Link>
          <Link to="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
        </nav>
        <p className="leading-relaxed max-w-3xl">
          KovaGPT is an AI assistant for writing, studying, coding, research, and image generation.
          AI can make mistakes, and search, research, image, and connected-app features can depend
          on plan eligibility and external providers. Always verify important information. Need
          help? Contact{" "}
          <a href="mailto:support@kovagpt.com" className="underline hover:text-foreground">
            support@kovagpt.com
          </a>
          .
        </p>
        <p className="max-w-3xl text-xs leading-relaxed opacity-80">
          KovaGPT is independently developed. Third-party product names used in editorial
          comparisons belong to their respective owners and do not imply sponsorship, endorsement,
          or affiliation.
        </p>
        <p className="text-xs opacity-70">© {new Date().getFullYear()} KovaGPT</p>
      </div>
    </footer>
  );
}
