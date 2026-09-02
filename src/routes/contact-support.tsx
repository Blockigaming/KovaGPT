import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalArticle } from "@/components/LegalArticle";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/contact-support")({
  head: () => ({
    meta: [
      { title: "KovaGPT Support" },
      {
        name: "description",
        content: "Get help with KovaGPT - billing, bugs, feature requests, and account questions.",
      },
      { property: "og:title", content: "Contact Support - KovaGPT" },
      {
        property: "og:description",
        content: "Get help with KovaGPT - billing, bugs, feature requests, and account questions.",
      },
      { property: "og:url", content: "https://kovagpt.com/contact-support" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/contact-support" }],
  }),
  component: ContactSupportPage,
});

function ContactSupportPage() {
  return (
    <PublicShell>
      <LegalArticle>
        <h1>Contact Support</h1>
        <p>Need help with KovaGPT? We're here to help.</p>
        <p>
          For account issues, billing questions, subscription problems, technical bugs, feature
          requests, or general support, email us at{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
        </p>
        <p>
          Please include as much detail as possible so we can help faster. If you are reporting a
          bug, include what page you were on, what you clicked, what happened, and what you expected
          to happen. We try to respond as quickly as possible.
        </p>

        <h2>Billing Help</h2>
        <p>
          For payment issues, subscription problems, failed charges, accidental purchases, or refund
          questions, contact <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>. Please
          include the email connected to your KovaGPT account and a short explanation of the issue.
        </p>

        <h2>Report a Bug</h2>
        <p>
          Found a bug? Email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> with the
          page you were on, what happened, what you expected to happen, and a screenshot if
          possible.
        </p>

        <h2>Request a Feature</h2>
        <p>
          Have an idea for KovaGPT? Send feature requests to{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>. We review suggestions as we
          improve the product.
        </p>

        <h2>Account and Data Deletion</h2>
        <p>
          Use the account and item deletion controls in KovaGPT Settings when they are available. If
          a request is not covered in the product, contact{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the email connected to
          your account. Please include "Account Deletion Request" in the subject line. After
          receiving your request, we may ask for confirmation to make sure the request is coming
          from the correct account owner. Some billing, security, legal, backup, or
          external-provider records can remain as described in the Privacy Policy.
        </p>

        <h2>Frequently Asked Questions</h2>

        <h3>How do I get help with billing?</h3>
        <p>
          Email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> with the email
          connected to your KovaGPT account and a short explanation of the issue.
        </p>

        <h3>How do I report a bug?</h3>
        <p>
          Email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> and include what page
          you were on, what happened, what you expected, and a screenshot if possible.
        </p>

        <h3>How do I request account deletion?</h3>
        <p>
          Email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the email
          connected to your account and include "Account Deletion Request" in the subject line.
        </p>

        <h3>How do I request a feature?</h3>
        <p>
          Email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> with your idea. We
          review suggestions as KovaGPT improves.
        </p>

        <p className="mt-12">
          New to KovaGPT? <Link to="/getting-started">Read the Getting Started guide →</Link>
        </p>

        <p className="mt-4">
          <Link to="/">← Back to KovaGPT</Link>
        </p>
      </LegalArticle>
    </PublicShell>
  );
}
