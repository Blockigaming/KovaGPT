import "./public-website.css";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicPlans } from "./PublicPlans";

export const WEBSITE_FAQ = [
  [
    "What is KovaGPT and how does it work?",
    "KovaGPT is an AI workspace for asking questions, writing, working with supported files, and organizing projects. Responses are generated from your prompt and the context you choose to provide. Check important information against its original sources.",
  ],
  [
    "What should I use KovaGPT for?",
    "Explore an idea, understand a topic, draft something, compare sources, or break a project into smaller steps. Give KovaGPT your goal, audience, constraints, and relevant material, then review and refine the result.",
  ],
  [
    "How much does it cost to use?",
    "Free is $0. Kova Plus is $16 per month and Kova Pro is $80 per month, in USD before applicable taxes. Paid plans renew monthly. Checkout confirms the price and any applicable offer before payment.",
  ],
  [
    "What changes between Free, Plus, and Pro?",
    "The plans have different message, Thinking, image, upload, and memory allowances. Compare the published plan details below. Tools also depend on provider availability and your account permissions; a paid plan does not automatically connect another service.",
  ],
  [
    "Can I cancel a subscription?",
    "Use Billing in account Settings to open the supported subscription-management options. Review the effective date in the billing portal before confirming. Contact support if the portal is unavailable.",
  ],
  [
    "How do connections work?",
    "You choose which services to connect and review the permissions they request. A connection only provides access you have authorized. Some connections are still coming soon or need additional configuration.",
  ],
  [
    "Can I control my data?",
    "Settings includes memory and data controls. Temporary chats do not use or update memory. Review the Privacy Policy for details about retained records, providers, and account deletion.",
  ],
  [
    "Which models can I use?",
    "The model and Thinking options shown in your account depend on your plan and the configured providers. Published product modes describe how KovaGPT handles a request; they are not a promise of access to a specific upstream model.",
  ],
] as const;

export function WebsiteBrand() {
  return (
    <Link to="/" className="public-website-brand" aria-label="KovaGPT home">
      <NovaLogo decorative className="public-website-mark" />
      <span>KovaGPT</span>
    </Link>
  );
}

export function PublicWebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-website">
      <header className="public-website-header">
        <nav aria-label="Public navigation">
          <WebsiteBrand />
        </nav>
      </header>
      {children}
      <PublicFooter />
    </div>
  );
}

export function WebsiteFaq() {
  return (
    <section className="public-website-faq" aria-labelledby="public-faq-title">
      <h2 id="public-faq-title">Frequently asked questions</h2>
      <div>
        {WEBSITE_FAQ.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <span aria-hidden="true">›</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function PublicWebsiteHome({
  mode = "sign-in",
  pending = false,
}: {
  mode?: "sign-in" | "sign-up";
  pending?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <PublicWebsiteLayout>
      <main id="main-content" tabIndex={-1} aria-busy={pending || undefined}>
        <section className="public-website-hero" aria-labelledby="public-home-title">
          <div className="public-website-hero-left">
            <h1 id="public-home-title">Question what’s next</h1>
            <p className="public-website-subtitle">Your thinking partner for big ambitions</p>
            <AuthDialog open={open} mode={mode} onOpenChange={setOpen} inline />
            <p className="public-desktop-availability">
              Use KovaGPT in your browser.{" "}
              <Link to={"/downloads" as never}>Desktop availability</Link>
            </p>
          </div>
          <figure className="public-classroom">
            <img
              src="/images/classroom-hero.webp"
              width={1312}
              height={936}
              fetchPriority="high"
              alt="Students in a classroom, with a student in an orange sweater raising her hand."
            />
          </figure>
        </section>
        <PublicPlans />
        <WebsiteFaq />
      </main>
    </PublicWebsiteLayout>
  );
}
