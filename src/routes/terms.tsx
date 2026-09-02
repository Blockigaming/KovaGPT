import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

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
      { property: "og:url", content: "https://kovagpt.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 prose prose-invert prose-lg leading-relaxed prose-headings:mt-10 prose-p:my-5"
      >
        <h1>Terms of Service</h1>
        <p>By using KovaGPT, you agree to use the service responsibly and follow these terms.</p>

        <h2>Use of KovaGPT</h2>
        <p>
          KovaGPT is an AI assistant for writing, learning, coding, research, image generation, and
          general productivity. You are responsible for how you use the service and any content you
          create with it.
        </p>

        <h2>AI Accuracy</h2>
        <p>
          KovaGPT can make mistakes. Responses may be incorrect, incomplete, or outdated. You should
          verify important information before relying on it.
        </p>

        <h2>No Professional Advice</h2>
        <p>
          KovaGPT does not provide medical, legal, financial, safety, or emergency advice. Do not
          rely on KovaGPT as your only source for important decisions.
        </p>

        <h2>User Content</h2>
        <p>
          You are responsible for the prompts, files, messages, and content you submit. Do not
          upload content you do not have permission to use.
        </p>

        <h2>Prohibited Use</h2>
        <p>
          You may not use KovaGPT to break the law, harm others, abuse the service, bypass limits,
          attack the platform, generate harmful content, or violate another person's rights.
        </p>

        <h2>Subscriptions</h2>
        <p>
          Paid plans provide access to additional features and higher limits. Features and limits
          may change over time. You are responsible for managing your subscription. You can cancel
          from your account settings; canceling stops future renewals but your current plan may
          remain active until the end of the billing period.
        </p>

        <h2>Account Security</h2>
        <p>
          You are responsible for keeping your account secure. Do not share your login information
          with others.
        </p>

        <h2>Changes to the Service</h2>
        <p>KovaGPT may change, update, limit, or remove features as the product improves.</p>

        <h2>Contact</h2>
        <p>
          For questions about these terms, contact{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
        </p>

        <p className="mt-8">
          <Link to="/">← Back to KovaGPT</Link> · <Link to="/privacy">Privacy Policy</Link>
        </p>
      </main>
    </PublicShell>
  );
}
