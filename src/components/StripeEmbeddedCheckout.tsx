import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getStripe } from "@/lib/stripe";
import { createCheckoutSession } from "@/utils/payments.functions";

interface Props {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId?: string;
}

export function StripeEmbeddedCheckout({ priceId, quantity, customerEmail, userId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const fetchClientSecret = async (): Promise<string> => {
    try {
      const result = await createCheckoutSession({
        data: {
          priceId,
          quantity,
        },
      });
      if ("error" in result) throw new Error(result.error);
      if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
      setReady(true);
      return result.clientSecret;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to start checkout";
      setError(msg);
      throw e;
    }
  };

  if (error) {
    return (
      <div className="p-8 text-center text-sm">
        <p className="font-medium mb-2">Checkout couldn't load</p>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div id="checkout" className="relative min-h-[480px]">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading secure checkout…
        </div>
      )}
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
