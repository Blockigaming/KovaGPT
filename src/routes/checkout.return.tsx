import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleAlert, Clock3, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { BILLING_ENV } from "@/lib/billing-plans";
import { getSubscriptionSummary, type SubscriptionSummary } from "@/utils/payments.functions";

type VerificationState =
  | { kind: "checking" }
  | { kind: "pending" }
  | { kind: "active"; tier: "plus" | "pro" }
  | { kind: "error" };

function normalizeCheckoutSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^cs_(?:live|test)_[A-Za-z0-9]{16,192}$/.test(normalized) ? normalized : undefined;
}

function checkoutVerificationForTier(
  tier: SubscriptionSummary["tier"],
): { kind: "pending" } | { kind: "active"; tier: "plus" | "pro" } {
  return tier === "plus" || tier === "pro" ? { kind: "active", tier } : { kind: "pending" };
}

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (s: Record<string, unknown>): { session_id?: string } => ({
    session_id: normalizeCheckoutSessionId(s.session_id),
  }),
  component: CheckoutReturn,
  head: () => ({
    meta: [
      { title: "KovaGPT Checkout" },
      {
        name: "description",
        content: "Return to KovaGPT after checkout and verify your account's subscription status.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Verify KovaGPT Checkout" },
      {
        property: "og:description",
        content:
          "Check the server-verified subscription status for your signed-in KovaGPT account.",
      },
      { property: "og:url", content: "https://kovagpt.com/checkout/return" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/checkout/return" }],
  }),
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  const { isLoaded, isSignedIn } = useUser();
  const { openSignIn } = useClerkSafe();
  const [attempt, setAttempt] = useState(0);
  const [verification, setVerification] = useState<VerificationState>({ kind: "checking" });

  useEffect(() => {
    if (!session_id || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    setVerification({ kind: "checking" });
    void getSubscriptionSummary({ data: { environment: BILLING_ENV } })
      .then((summary) => {
        if (!cancelled) setVerification(checkoutVerificationForTier(summary.tier));
      })
      .catch(() => {
        if (!cancelled) setVerification({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, isLoaded, isSignedIn, session_id]);

  const status = (() => {
    if (!session_id) {
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <CircleAlert className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Checkout link not verified</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            This return link is incomplete or invalid. It cannot activate a subscription. If you
            completed checkout, open Settings → Subscription after signing in to refresh your
            billing status.
          </p>
        </>
      );
    }

    if (!isLoaded) {
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Checking your account</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Wait while KovaGPT loads the account used for checkout.
          </p>
        </>
      );
    }

    if (!isSignedIn) {
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Sign in to verify your plan</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            KovaGPT only checks subscription status for the signed-in account. The checkout session
            ID alone never grants access.
          </p>
          <button
            type="button"
            onClick={openSignIn}
            className="mb-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Sign in to verify
          </button>
        </>
      );
    }

    if (verification.kind === "checking") {
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Verifying your subscription</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            KovaGPT is checking the server-recorded plan for this signed-in account.
          </p>
        </>
      );
    }

    if (verification.kind === "active") {
      const planName = verification.tier === "pro" ? "Pro" : "Plus";
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-green-500/20 text-green-600 dark:text-green-400">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Current subscription confirmed</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            KovaGPT confirmed that this signed-in account currently has a {planName} subscription.
          </p>
        </>
      );
    }

    if (verification.kind === "pending") {
      return (
        <>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Clock3 className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Subscription verification pending</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            A paid plan has not yet been confirmed for this account. Provider updates can take a
            moment, and this page never grants access on its own.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((current) => current + 1)}
            className="mb-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            Check again
          </button>
        </>
      );
    }

    return (
      <>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
          <CircleAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold">Subscription status unavailable</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          KovaGPT could not verify this account's billing status. No access was changed. Try again
          or refresh billing status from Settings → Subscription.
        </p>
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          className="mb-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Try again
        </button>
      </>
    );
  })();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <main
        className="max-w-md text-center"
        aria-live="polite"
        aria-busy={Boolean(
          session_id && (!isLoaded || (isSignedIn && verification.kind === "checking")),
        )}
      >
        <NovaLogo className="mx-auto mb-4 h-12 w-12" />
        {status}
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          Back to KovaGPT
        </Link>
      </main>
    </div>
  );
}
