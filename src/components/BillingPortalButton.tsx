import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/auth/ClerkSafe";
import { createPortalSession } from "@/utils/payments.functions";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";

export function BillingPortalButton({
  priceId,
  children = "Manage subscription in Stripe",
}: {
  priceId?: string;
  children?: React.ReactNode;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const scope = JSON.stringify([owner, priceId]);
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(false);
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    pending.current = false;
    setBusy(false);
    setError("");
    return () => {
      request.current++;
    };
  }, [scope]);
  const open = async () => {
    if (!owner || pending.current) return;
    pending.current = true;
    const token = ++request.current;
    const active = () => current.current === scope && request.current === token;
    setBusy(true);
    setError("");
    try {
      const result = await createPortalSession({ data: priceId ? { priceId } : {} });
      if (!active()) return;
      if ("error" in result) throw new Error(result.error);
      const url = parseAllowedBillingPortalUrl(result.url);
      if (!url) throw new Error("Secure billing could not open. Please try again.");
      window.location.assign(url);
    } catch (error) {
      if (active())
        setError(
          error instanceof Error ? error.message : "Billing could not open. Please try again.",
        );
    } finally {
      if (request.current === token) pending.current = false;
      if (active()) setBusy(false);
    }
  };
  return (
    <div className="my-4">
      <Button type="button" variant="outline" disabled={!owner || busy} onClick={() => void open()}>
        {busy ? "Opening secure billing…" : children}
      </Button>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
