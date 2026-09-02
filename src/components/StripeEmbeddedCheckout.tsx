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

const CHECKOUT_ERROR_MESSAGE =
  "Secure checkout couldn't load. Close this window and try again. If the problem continues, contact support.";
const ACTIVE_SUBSCRIPTION_ERROR_MESSAGE =
  "You already have an active subscription. Manage your plan from the billing portal before starting a new one.";

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}

export function StripeEmbeddedCheckout({ priceId, quantity, customerEmail, userId }: Props) {
  const [checkoutErrorMessage, setCheckoutErrorMessage] = useState<string | null>(null);
  const [checkoutFrameLoaded, setCheckoutFrameLoaded] = useState(false);

  const fetchClientSecret = async (): Promise<string> => {
    let publicErrorMessage = CHECKOUT_ERROR_MESSAGE;
    try {
      const result = await createCheckoutSession({
        data: {
          priceId,
          quantity,
        },
      });
      if ("error" in result) {
        if (result.error === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE) {
          publicErrorMessage = ACTIVE_SUBSCRIPTION_ERROR_MESSAGE;
        }
        throw new Error(result.error);
      }
      if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
      return result.clientSecret;
    } catch (error) {
      console.error("[KovaGPT checkout] Unable to initialize Stripe checkout", {
        errorName: safeErrorName(error),
      });
      setCheckoutErrorMessage(publicErrorMessage);
      throw new Error(publicErrorMessage, { cause: error });
    }
  };

  if (checkoutErrorMessage) {
    const errorTitle =
      checkoutErrorMessage === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE
        ? "Manage your current plan"
        : "Checkout couldn't load";
    return (
      <div data-checkout-state="error" className="p-8 text-center text-sm">
        <p className="font-medium mb-2">{errorTitle}</p>
        <p className="text-muted-foreground">{checkoutErrorMessage}</p>
      </div>
    );
  }

  return (
    <div
      id="checkout"
      data-checkout-state={checkoutFrameLoaded ? "loaded" : "loading"}
      className="relative min-h-[480px]"
      onLoadCapture={(event) => {
        if (event.target instanceof HTMLIFrameElement) setCheckoutFrameLoaded(true);
      }}
    >
      {!checkoutFrameLoaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading secure checkout…
        </div>
      )}
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
