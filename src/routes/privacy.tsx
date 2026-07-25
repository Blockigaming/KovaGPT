import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";
import { LegalArticle } from "@/components/LegalArticle";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - KovaGPT" },
      {
        name: "description",
        content:
          "KovaGPT is built privacy-first. We do not sell your data, we do not read your chats, and we do not train models on your conversations.",
      },
      { property: "og:title", content: "Privacy Policy - KovaGPT" },
      {
        property: "og:description",
        content:
          "KovaGPT is built privacy-first. We do not sell your data, we do not read your chats, and we do not train models on your conversations.",
      },
      { property: "og:url", content: "https://kovagpt.com/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <LegalArticle>
        <h1>Privacy Policy</h1>
        <p>
          <strong>KovaGPT is built privacy-first.</strong> Your chats are yours. We do not sell your
          data, we do not read your conversations, and we do not use your prompts, files, or
          generated content to train AI models. Period.
        </p>

        <h2>Our Privacy Promises</h2>
        <ul>
          <li>
            <strong>We do not sell your data.</strong> Ever. To anyone.
          </li>
          <li>
            <strong>We do not read your chats.</strong> Staff do not browse, review, or monitor user
            conversations.
          </li>
          <li>
            <strong>We do not train on your content.</strong> Your prompts, uploads, and generated
            outputs are never used to train KovaGPT or any third-party model.
          </li>
          <li>
            <strong>No ad tracking.</strong> KovaGPT does not run advertising trackers or share your
            activity with ad networks.
          </li>
          <li>
            <strong>You stay in control.</strong> Delete a chat any time. Delete your account any
            time. We honor it.
          </li>
        </ul>

        <h2>What We Collect</h2>
        <p>
          Only what we need to run the product: your email and login info, your subscription status,
          the chats you choose to save to your account, files you upload to a chat, generated images
          you save to your library, and basic technical signals (browser type, error logs) used to
          keep the service running and secure.
        </p>

        <h2>How We Use Information</h2>
        <p>
          We use this information solely to: deliver KovaGPT to you, save and load your own chats,
          process your subscription, detect and prevent abuse of the service, and fix bugs. We do
          not profile you, score you, or build advertising audiences from your activity.
        </p>

        <h2>AI Processing</h2>
        <p>
          To answer a message, the text and any attachments you send are processed by AI providers
          strictly to generate that response. Providers we use are contractually prohibited from
          training on your content. Once the response is returned, that processing is complete.
        </p>

        <h2>Payments</h2>
        <p>
          Payments are handled by Stripe. KovaGPT never sees or stores your full card number; Stripe
          sends us only the subscription status we need to unlock features.
        </p>

        <h2>Uploaded Files and Generated Content</h2>
        <p>
          Files and images live in your account so you can come back to them. They are not shared,
          indexed publicly, or made available to other users. Delete them whenever you want from the
          Library, or email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> and we will
          erase them for you.
        </p>

        <h2>Account and Data Deletion</h2>
        <p>
          To delete your account or any specific data, email{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the address tied to your
          account with the subject "Account Deletion Request". We will confirm and then remove your
          account, chats, uploads, and library content from active systems.
        </p>

        <h2>Security</h2>
        <p>
          Data is encrypted in transit (HTTPS) and at rest. Access to production systems is
          restricted to a small number of operators and is audit-logged. We do not retain payment
          card data.
        </p>

        <h2>Children and Teens</h2>
        <p>
          KovaGPT is intended to be used responsibly. Younger users should use the service with
          permission from a parent or guardian where required by local law.
        </p>

        <h2>Changes</h2>
        <p>
          If we ever change this policy in a way that affects how your data is handled, we will
          update this page and, where appropriate, notify you in-app or by email.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions or requests:{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
        </p>

        <p className="mt-12">
          <Link to="/">. Back to KovaGPT</Link> . <Link to="/terms">Terms of Service</Link>
        </p>
      </LegalArticle>
      <PublicFooter />
    </>
  );
}
