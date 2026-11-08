import { BillingPortalButton } from "@/components/BillingPortalButton";
import { PublicFooter } from "@/components/PublicFooter";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

export const Route = createFileRoute("/subscribe")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" && resolveBillingPlan(search.plan) ? search.plan : "",
  }),
  component: CheckoutPage,
});
function CheckoutPage() {
  const { openSignIn } = useClerkSafe();
  const { plan } = Route.useSearch();
  const selectedPlan = resolveBillingPlan(plan);
  const publishedPlan = selectedPlan ? CAPABILITY_REGISTRY.plans[selectedPlan.tier] : null;
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-border px-6 py-5">
        <h1 className="text-xl font-semibold">Complete your subscription</h1>
        <Link to="/pricing" className="rounded-xl border border-border px-4 py-2">
          Back to plans
        </Link>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-10">
        <p className="mb-6 text-muted-foreground">
          Review your plan, payment and renewal details securely with Stripe.
        </p>
        {publishedPlan && (
          <section
            aria-label="Plan price before tax"
            className="mb-6 rounded-3xl border border-border p-6"
          >
            <h2 className="text-lg font-semibold">Kova {publishedPlan.name}</h2>
            <p className="mt-2 text-3xl font-semibold">
              ${publishedPlan.monthlyPriceUsd}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / month before tax
              </span>
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              This is the subscription price before discounts and tax. Stripe shows any discount,
              applicable tax, and the final amount due before you confirm payment.
            </p>
          </section>
        )}
        {!plan ? (
          <p>Choose a plan to continue.</p>
        ) : !isLoaded ? (
          <div className="h-96 animate-pulse rounded-3xl bg-muted" aria-label="Checking account" />
        ) : !isSignedIn ? (
          <button
            type="button"
            className="rounded-xl border border-border px-4 py-2"
            onClick={() => openSignIn()}
          >
            Sign in to continue
          </button>
        ) : (
          <>
            <BillingPortalButton />
            <StripeEmbeddedCheckout key={`${user?.id}:${plan}`} priceId={plan} userId={user?.id} />
          </>
        )}
      </section>
      <PublicFooter />
    </main>
  );
}
