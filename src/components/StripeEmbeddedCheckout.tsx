import { useEffect, useRef, useState, useCallback } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { createCheckoutSession, createPortalSession } from "@/utils/payments.functions";
const CHECKOUT_ERROR_MESSAGE = "Secure checkout could not open. Try again.";
const ACTIVE_SUBSCRIPTION_ERROR_MESSAGE =
  "You already have an active subscription. Manage your plan from the billing portal before starting a new one.";
const SAFE_CHECKOUT_ERRORS = new Set([
  ACTIVE_SUBSCRIPTION_ERROR_MESSAGE,
  "Billing status couldn't be verified. Try again.",
  "Checkout is being reconciled. Retry shortly or contact support; no second payment attempt was started.",
  "Checkout is unavailable right now. Try again.",
]);

// Kept as an export for existing callers; payments now use Stripe's full-page hosted checkout.
export function StripeEmbeddedCheckout({
  priceId,
  quantity,
  userId,
  autoStart = false,
}: {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId?: string;
  autoStart?: boolean;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const scope = JSON.stringify([owner, priceId, quantity]);
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    pending.current = false;
    return () => {
      generation.current++;
    };
  }, [scope]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkout = useCallback(async () => {
    if (!owner || (userId && owner !== userId) || pending.current) return;
    pending.current = true;
    const token = ++generation.current;
    const active = () => current.current === scope && generation.current === token;
    setBusy(true);
    setError("");
    try {
      const result = await createCheckoutSession({ data: { priceId, quantity } });
      if (!active()) return;
      if ("error" in result && result.error === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE) {
        const portal = await createPortalSession({ data: { priceId } });
        if (!active()) return;
        if ("error" in portal) throw new Error(CHECKOUT_ERROR_MESSAGE);
        const portalUrl = parseAllowedBillingPortalUrl(portal.url);
        if (!portalUrl) throw new Error(CHECKOUT_ERROR_MESSAGE);
        window.location.assign(portalUrl);
        return;
      }
      if ("error" in result) throw new Error(result.error);
      const url = new URL(result.url);
      if (url.origin !== "https://checkout.stripe.com")
        throw new Error("Secure checkout could not open.");
      publishKovaNotice({ id: "checkout_started", title: "Opening secure checkout", message: "Your subscription is not active until payment is confirmed." });
      window.location.assign(url.href);
    } catch (reason) {
      if (active()) {
        setError(
          reason instanceof Error && SAFE_CHECKOUT_ERRORS.has(reason.message)
            ? reason.message
            : CHECKOUT_ERROR_MESSAGE,
        );
        publishKovaNotice({ id: "checkout_unavailable", title: "Checkout unavailable", message: "The payment page did not open. You can retry without starting a second checkout." });
      }
    } finally {
      if (generation.current === token) pending.current = false;
      if (active()) setBusy(false);
    }
  }, [owner, userId, priceId, quantity, scope]);
  useEffect(() => {
    if (!autoStart || !owner) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void checkout();
    });
    return () => {
      cancelled = true;
    };
  }, [autoStart, owner, checkout]);
  return (
    <div
      className="space-y-4"
      data-stripe-experience="kova-stripe-checkout:hosted-v1"
      data-checkout-state={error ? "error" : busy ? "loading" : "ready"}
    >
      {!autoStart || error ? (
        <Button
          className="min-h-11 rounded-full"
          disabled={busy || !owner || Boolean(userId && owner !== userId)}
          onClick={() => void checkout()}
        >
          {busy ? "Opening checkout…" : error ? "Retry checkout" : "Continue to payment"}
        </Button>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Redirecting to secure checkout…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {error?.includes("subscription") && <BillingPortalButton />}
      {!autoStart && (
        <p className="text-sm text-muted-foreground">
          Payment opens full-screen in Stripe. Review the total and renewal terms before paying.
        </p>
      )}
    </div>
  );
}
