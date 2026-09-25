import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalDoc, LegalDocEndnote, LegalDocHero } from "@/components/public/LegalDoc";
import type { LegalDocSection } from "@/components/public/LegalDoc";
import { PublicShell } from "@/components/public/PublicShell";

const SECTIONS: readonly LegalDocSection[] = [
  { id: "use", label: "Use of KovaGPT" },
  { id: "accuracy", label: "AI accuracy" },
  { id: "advice", label: "No professional advice" },
  { id: "content", label: "User content" },
  { id: "prohibited", label: "Prohibited use" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "account-security", label: "Account security" },
  { id: "changes", label: "Changes to the service" },
  { id: "contact", label: "Contact" },
];

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "KovaGPT Terms" },
      {
        name: "description",
        content:
          "The rules for using KovaGPT, including payments, acceptable use, and AI accuracy.",
      },
      { property: "og:title", content: "Terms of Service - KovaGPT" },
      {
        property: "og:description",
        content:
          "The rules for using KovaGPT, including payments, acceptable use, and AI accuracy.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://kovagpt.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <LegalDocHero
          eyebrow="KovaGPT legal"
          title="Terms of Service"
          description="By using KovaGPT, you agree to use the service responsibly and follow these terms."
        />
        <LegalDoc sections={SECTIONS}>
          <section id="use" data-legal-section className="legal-section">
            <h2>Use of KovaGPT</h2>
            <p>
              KovaGPT is an AI assistant for writing, learning, coding, research, image generation,
              and general productivity. You are responsible for how you use the service and any
              content you create with it.
            </p>
          </section>

          <section id="accuracy" data-legal-section className="legal-section">
            <h2>AI Accuracy</h2>
            <p>
              KovaGPT can make mistakes. Responses may be incorrect, incomplete, or outdated. You
              should verify important information before relying on it.
            </p>
          </section>

          <section id="advice" data-legal-section className="legal-section">
            <h2>No Professional Advice</h2>
            <p>
              KovaGPT does not provide medical, legal, financial, safety, or emergency advice. Do
              not rely on KovaGPT as your only source for important decisions.
            </p>
          </section>

          <section id="content" data-legal-section className="legal-section">
            <h2>User Content</h2>
            <p>
              You are responsible for the prompts, files, messages, and content you submit. Do not
              upload content you do not have permission to use.
            </p>
          </section>

          <section id="prohibited" data-legal-section className="legal-section">
            <h2>Prohibited Use</h2>
            <p>
              You may not use KovaGPT to break the law, harm others, abuse the service, bypass
              limits, attack the platform, generate harmful content, or violate another person's
              rights.
            </p>
          </section>

          <section id="subscriptions" data-legal-section className="legal-section">
            <h2>Subscriptions</h2>
            <p>
              Paid plans provide access to additional features and higher limits. Features and
              limits may change over time. You are responsible for managing your subscription. You
              can cancel from your account settings; canceling stops future renewals but your
              current plan may remain active until the end of the billing period.
            </p>
          </section>

          <section id="account-security" data-legal-section className="legal-section">
            <h2>Account Security</h2>
            <p>
              You are responsible for keeping your account secure. Do not share your login
              information with others.
            </p>
          </section>

          <section id="changes" data-legal-section className="legal-section">
            <h2>Changes to the Service</h2>
            <p>KovaGPT may change, update, limit, or remove features as the product improves.</p>
          </section>

          <section id="contact" data-legal-section className="legal-section">
            <h2>Contact</h2>
            <p>
              For questions about these terms, contact{" "}
              <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
            </p>
          </section>
        </LegalDoc>

        <LegalDocEndnote>
          <Link to="/">Back to KovaGPT</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/refund">Refund Policy</Link>
        </LegalDocEndnote>
      </main>
    </PublicShell>
  );
}
