import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "KovaGPT Refunds" },
      {
        name: "description",
        content: "How KovaGPT handles subscription cancellations and refund requests.",
      },
      { property: "og:title", content: "Refund Policy - KovaGPT" },
      {
        property: "og:description",
        content: "How KovaGPT handles subscription cancellations and refund requests.",
      },
      { property: "og:url", content: "https://kovagpt.com/refund" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/refund" }],
  }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 prose prose-invert prose-lg leading-relaxed prose-headings:mt-10 prose-p:my-5"
      >
        <h1>Refund Policy</h1>
        <p>
          KovaGPT subscriptions help provide access to AI tools, usage limits, image generation,
          file uploads, and other premium features.
        </p>
        <p>
          Subscriptions can be canceled from your account settings. Canceling a subscription stops
          future renewals but does not automatically refund past payments.
        </p>
        <p>
          Refunds may be reviewed on a case-by-case basis. If you believe you were charged by
          mistake, had a billing issue, or could not access paid features after payment, contact{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> with your account email and a
          description of the issue.
        </p>
        <p>
          KovaGPT reserves the right to deny refund requests if the paid features were used, if the
          request appears abusive, or if the request does not meet our refund standards.
        </p>

        <h2>Payments</h2>
        <p>
          Paid subscriptions are processed through a secure payment provider. KovaGPT does not
          directly store your full credit card number.
        </p>

        <h2>Cancel Subscription</h2>
        <p>
          You can cancel your KovaGPT subscription from your account settings. Canceling stops
          future renewals, but your current plan may remain active until the end of the billing
          period. If you need help canceling, contact{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
        </p>

        <p className="mt-8">
          <Link to="/">← Back to KovaGPT</Link>
        </p>
      </main>
    </PublicShell>
  );
}
