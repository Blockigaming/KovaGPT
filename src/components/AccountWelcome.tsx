import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SignInButton, SignUpButton } from "@/components/auth/ClerkSafe";
import { NovaLogo } from "@/components/NovaLogo";

export default function AccountWelcome() {
  return (
    <main id="main-content" className="kova-account-gate" tabIndex={-1}>
      <div className="kova-account-gate-brand">
        <NovaLogo decorative className="h-8 w-8" /> KovaGPT
      </div>
      <section className="kova-account-gate-card" aria-labelledby="account-gate-heading">
        <span className="kova-account-gate-eyebrow">Your ideas, together.</span>
        <h1 id="account-gate-heading">
          A little space for
          <br />
          your next big thing.
        </h1>
        <p>Sign in to chat, create images, keep your files, and pick up where you left off.</p>
        <div className="kova-account-gate-actions">
          <SignInButton>
            <button type="button" className="kova-account-gate-primary">
              Log in <ArrowRight aria-hidden="true" />
            </button>
          </SignInButton>
          <SignUpButton>
            <button type="button" className="kova-account-gate-secondary">
              Create an account
            </button>
          </SignUpButton>
        </div>
        <div className="kova-account-gate-links">
          <Link to="/help">Help</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
      </section>
    </main>
  );
}
