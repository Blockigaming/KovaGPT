import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock3 } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (s: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  component: CheckoutReturn,
  head: () => ({
    meta: [
      { title: "KovaGPT Checkout" },
      {
        name: "description",
        content:
          "KovaGPT is verifying your checkout with Stripe. Subscription access appears only after server-side confirmation.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Checkout verification - KovaGPT" },
      {
        property: "og:description",
        content: "KovaGPT is verifying the checkout result with Stripe.",
      },
      { property: "og:url", content: "https://kovagpt.com/checkout/return" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/checkout/return" }],
  }),
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <NovaLogo className="w-12 h-12 mx-auto mb-4" />
        {session_id ? (
          <>
            <div className="w-14 h-14 rounded-full bg-muted text-muted-foreground mx-auto mb-4 grid place-items-center">
              <Clock3 className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Checkout received</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Stripe returned you to KovaGPT. We're verifying the subscription server-side; access
              will update only after that confirmation. You can refresh billing status in Settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold mb-2">No session found</h1>
            <p className="text-sm text-muted-foreground mb-6">
              We couldn't identify a checkout session from this page. This does not confirm a charge
              or an active subscription. Check billing status in Settings or contact support.
            </p>
          </>
        )}
        <Link
          to="/"
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition"
        >
          Back to KovaGPT
        </Link>
      </div>
    </div>
  );
}
