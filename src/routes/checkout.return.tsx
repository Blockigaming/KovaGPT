import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";

import { recordGrowthEvent } from "@/lib/growth-events";
import { useEffect } from "react";
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
          "Your KovaGPT subscription is now active. Access advanced AI modes, web search, image generation, and priority models on every device.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Payment Successful - KovaGPT" },
      {
        property: "og:description",
        content:
          "Your KovaGPT subscription is now active. Access all advanced AI modes and priority features.",
      },
      { property: "og:url", content: "https://kovagpt.com/checkout/return" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/checkout/return" }],
  }),
});

function CheckoutReturn() {
  useEffect(() => {
    void recordGrowthEvent("checkout_completed", {
      surface: "checkout_return",
    });
  }, []);

  const { session_id } = Route.useSearch();
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <NovaLogo className="w-12 h-12 mx-auto mb-4" />
        {session_id ? (
          <>
            <div className="w-14 h-14 rounded-full bg-green-500/20 text-green-500 mx-auto mb-4 grid place-items-center">
              <Check className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Subscription activated</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Your subscription is active. Welcome to KovaGPT.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold mb-2">No session found</h1>
            <p className="text-sm text-muted-foreground mb-6">
              We couldn't find your checkout session. If you completed a payment, it should still go
              through.
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
