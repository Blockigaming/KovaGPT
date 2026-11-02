import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Stripe } from "@stripe/stripe-js";
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
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [activeSubscription, setActiveSubscription] = useState(false);
  const alive = useRef(true);
  const owner = useRef(userId);
  owner.current = userId;
  useEffect(() => {
    alive.current = true;
    let current = true;
    void Promise.resolve()
      .then(() => getStripe())
      .then((client) => {
        if (!current) return;
        if (!client) throw new Error("Stripe unavailable");
        setStripe(client);
      })
      .catch(() => {
        if (current) setCheckoutErrorMessage(CHECKOUT_ERROR_MESSAGE);
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, []);
  const [checkoutErrorMessage, setCheckoutErrorMessage] = useState<string | null>(null);
  const [checkoutFrameLoaded, setCheckoutFrameLoaded] = useState(false);

  const fetchClientSecret = useMemo(() => {
    let pending: Promise<string> | null = null;
    const create = async (): Promise<string> => {
      let publicErrorMessage = CHECKOUT_ERROR_MESSAGE;
      try {
        const result = await createCheckoutSession({
          data: {
            priceId,
            quantity,
          },
        });
        if (!alive.current || owner.current !== userId) throw new Error("Checkout account changed");
        if ("error" in result) {
          if (result.code === "active_subscription") {
            setActiveSubscription(true);
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
        if (alive.current && owner.current === userId) setCheckoutErrorMessage(publicErrorMessage);
        throw new Error(publicErrorMessage, { cause: error });
      }
    };
    // Stripe can request initialization more than once across React renders.
    // Reuse this one attempt; a rerender must never create another subscription.
    return () => (pending ??= create());
  }, [priceId, quantity, userId]);

  if (checkoutErrorMessage) {
    const errorTitle =
      checkoutErrorMessage === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE
        ? "Manage your current plan"
        : "Checkout couldn't load";
    return (
      <div data-checkout-state="error" className="p-8 text-center text-sm">
        <p className="font-medium mb-2">{errorTitle}</p>
        <p className="text-muted-foreground">{checkoutErrorMessage}</p>
        {activeSubscription && (
          <Link
            to="/settings/$section"
            params={{ section: "billing" }}
            className="mt-4 inline-block underline"
          >
            Manage current plan
          </Link>
        )}
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
      {stripe && (
        <EmbeddedCheckoutProvider stripe={stripe} options={{ fetchClientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      )}
    </div>
  );
}
