import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - KovaGPT" },
      { name: "description", content: "How KovaGPT collects, uses, stores, and protects your data." },
      { property: "og:title", content: "Privacy Policy - KovaGPT" },
      { property: "og:description", content: "How KovaGPT collects, uses, stores, and protects your data." },
      { property: "og:url", content: "https://kovagpt.com/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <main className="mx-auto max-w-3xl px-6 py-16 prose prose-invert prose-lg leading-relaxed prose-headings:mt-10 prose-p:my-5">
        <h1>Privacy Policy</h1>
        <p>KovaGPT respects your privacy. This Privacy Policy explains what information we collect, how we use it, and how you can contact us.</p>

        <h2>Information We Collect</h2>
        <p>When you use KovaGPT, we may collect account information such as your email address, login details, subscription status, chat history, uploaded files, generated images, usage limits, and basic technical information like device type, browser type, and error logs.</p>

        <h2>How We Use Information</h2>
        <p>We use this information to provide KovaGPT, save your chats, process subscriptions, prevent abuse, improve the product, fix bugs, and provide customer support.</p>

        <h2>AI Content</h2>
        <p>KovaGPT may process the messages, files, and prompts you provide in order to generate responses. Do not submit private, sensitive, or confidential information unless you are comfortable with it being processed by the service.</p>

        <h2>Payments</h2>
        <p>Payments and subscriptions may be handled by Stripe or another payment provider. KovaGPT does not directly store your full credit card number.</p>

        <h2>Uploaded Files</h2>
        <p>KovaGPT may allow users to upload files for AI analysis, summarization, or other features. Uploaded files should only contain content that you have permission to use. Do not upload private, sensitive, confidential, or personal information unless you are comfortable with it being processed by the service. Uploaded files may be stored temporarily or connected to your account depending on the feature being used. You may contact <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> for help with file or data deletion.</p>

        <h2>Data Deletion</h2>
        <p>You may contact <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> to request help with account or data deletion.</p>

        <h2>Account and Data Deletion</h2>
        <p>If you want to delete your KovaGPT account or request deletion of your data, contact <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the email connected to your account. Please include "Account Deletion Request" in the subject line. After receiving your request, we may ask for confirmation to make sure the request is coming from the correct account owner.</p>

        <h2>Children and Teens</h2>
        <p>KovaGPT is intended to be used responsibly. Younger users should use the service with permission from their parents when required.</p>

        <h2>Contact</h2>
        <p>For privacy questions, contact <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.</p>

        <p className="mt-8"><Link to="/">← Back to KovaGPT</Link> · <Link to="/terms">Terms of Service</Link></p>
      </main>
      <PublicFooter />
    </>
  );
}
