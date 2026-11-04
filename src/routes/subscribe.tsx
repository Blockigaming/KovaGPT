import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { resolveBillingPlan } from "@/lib/billing-plans";

export const Route = createFileRoute("/subscribe")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" && resolveBillingPlan(search.plan) ? search.plan : "",
  }),
  component: CheckoutPage,
});
function CheckoutPage() {
  const { plan } = Route.useSearch();
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <main className="min-h-dvh bg-background text-foreground">
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
        {!plan ? (
          <p>Choose a plan to continue.</p>
        ) : !isLoaded ? (
          <div className="h-96 animate-pulse rounded-3xl bg-muted" aria-label="Checking account" />
        ) : !isSignedIn ? (
          <p>Sign in before starting checkout.</p>
        ) : (
          <StripeEmbeddedCheckout key={`${user?.id}:${plan}`} priceId={plan} userId={user?.id} />
        )}
      </section>
    </main>
  );
}
