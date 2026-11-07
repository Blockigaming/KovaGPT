import { useRef, useState } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { createCheckoutSession } from "@/utils/payments.functions";

// Kept as an export for existing callers; payments now use Stripe's full-page hosted checkout.
export function StripeEmbeddedCheckout({
  priceId,
  quantity,
  userId,
}: {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId?: string;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const scope = JSON.stringify([owner, priceId, quantity]);
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function checkout() {
    if (!owner || (userId && owner !== userId) || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await createCheckoutSession({ data: { priceId, quantity } });
      if (current.current !== scope) return;
      if ("error" in result) throw new Error(result.error);
      const url = new URL(result.url);
      if (url.origin !== "https://checkout.stripe.com")
        throw new Error("Secure checkout could not open.");
      window.location.assign(url.href);
    } catch (reason) {
      if (current.current === scope)
        setError(reason instanceof Error ? reason.message : "Checkout could not open. Try again.");
    } finally {
      pending.current = false;
      if (current.current === scope) setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Button
        className="min-h-11 rounded-full"
        disabled={busy || !owner || Boolean(userId && owner !== userId)}
        onClick={() => void checkout()}
      >
        {busy ? "Opening secure checkout…" : "Continue to payment"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {error?.includes("subscription") && <BillingPortalButton />}
      <p className="text-sm text-muted-foreground">
        Payment opens full-screen in Stripe. Review the total and renewal terms before paying.
      </p>
    </div>
  );
}
