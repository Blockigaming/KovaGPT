import { createFileRoute, Link } from "@tanstack/react-router";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { resolveBillingPlan } from "@/lib/billing-plans";

export const Route = createFileRoute("/subscribe")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" && resolveBillingPlan(search.plan) ? search.plan : "",
  }),
  component: CheckoutPage,
});
function CheckoutPage() {
  const { openSignIn } = useClerkSafe();
  const { plan } = Route.useSearch();
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-dvh bg-background text-foreground">
      <section className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 text-center px-6 py-10">
        <h1 className="kova-checkout-wave text-xl font-semibold">Opening checkout…</h1>
        {!plan ? (
          <p>Choose a plan to continue.</p>
        ) : !isLoaded ? (
          <div
            className="h-12 w-full animate-pulse rounded-3xl bg-muted motion-reduce:animate-none"
            aria-label="Checking account"
          />
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
            <StripeEmbeddedCheckout
              key={`${user?.id}:${plan}`}
              priceId={plan}
              userId={user?.id}
              autoStart
            />
          </>
        )}
      </section>
      <Link to="/pricing" className="fixed left-6 top-6 rounded-full px-4 py-2">
        Back to plans
      </Link>
    </main>
  );
}
