import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getStripe } from "@/lib/stripe";
import { createCheckoutSession } from "@/utils/payments.functions";

interface Props {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId?: string;
}

const CHECKOUT_ERROR_MESSAGE =
  "Secure checkout couldn't load. Return to plans and try again. If the problem continues, contact support.";
const ACTIVE_SUBSCRIPTION_ERROR_MESSAGE =
  "You already have an active subscription. Manage your plan from the billing portal before starting a new one.";
const ROLLOUT_ERROR_MESSAGE = "Billing is awaiting its verified rollout. Contact support.";
const RETRYABLE_CHECKOUT_MESSAGES = new Set([
  "Billing status couldn't be verified. Try again.",
  "Checkout is being reconciled. Retry shortly or contact support; no second payment attempt was started.",
  "Checkout is unavailable right now. Try again.",
]);

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}

export function StripeEmbeddedCheckout({ priceId, quantity, userId }: Props) {
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [checkoutErrorMessage, setCheckoutErrorMessage] = useState<string | null>(null);
  const [checkoutFrameLoaded, setCheckoutFrameLoaded] = useState(false);
  const retry = () => {
    setCheckoutErrorMessage(null);
    setCheckoutFrameLoaded(false);
    setAttemptNumber((number) => number + 1);
  };
  const attemptRef = useRef<{ key: string; promise: Promise<string> | null }>({
    key: "",
    promise: null,
  });
  const attemptKey = JSON.stringify([userId, priceId, quantity, attemptNumber]);
  if (attemptRef.current.key !== attemptKey)
    attemptRef.current = { key: attemptKey, promise: null };
  const attempt = attemptRef.current;
  const stripe = useMemo(() => {
    try {
      return getStripe();
    } catch {
      return null;
    }
  }, [attemptNumber]);
  useEffect(() => {
    if (!stripe) return;
    let current = true;
    void stripe
      .then((client) => {
        if (current && !client) setCheckoutErrorMessage(CHECKOUT_ERROR_MESSAGE);
      })
      .catch(() => {
        if (current) setCheckoutErrorMessage(CHECKOUT_ERROR_MESSAGE);
      });
    return () => {
      current = false;
    };
  }, [stripe]);

  const fetchClientSecret = useCallback((): Promise<string> => {
    if (attempt.promise) return attempt.promise;
    attempt.promise = (async () => {
      let publicErrorMessage = CHECKOUT_ERROR_MESSAGE;
      try {
        const result = await createCheckoutSession({
          data: {
            priceId,
            quantity,
          },
        });
        if ("error" in result) {
          if (
            result.error === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE ||
            /already have an (?:active|open) subscription/u.test(result.error)
          ) {
            publicErrorMessage = ACTIVE_SUBSCRIPTION_ERROR_MESSAGE;
          } else if (
            result.error === ROLLOUT_ERROR_MESSAGE ||
            RETRYABLE_CHECKOUT_MESSAGES.has(result.error)
          ) {
            publicErrorMessage = result.error;
          }
          throw new Error(result.error);
        }
        if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
        return result.clientSecret;
      } catch (error) {
        console.error("[KovaGPT checkout] Unable to initialize Stripe checkout", {
          errorName: safeErrorName(error),
        });
        if (attemptRef.current === attempt) setCheckoutErrorMessage(publicErrorMessage);
        throw new Error(publicErrorMessage, { cause: error });
      }
    })();
    return attempt.promise;
  }, [attempt, priceId, quantity]);
  const checkoutOptions = useMemo(() => ({ fetchClientSecret }), [fetchClientSecret]);

  if (checkoutErrorMessage || !stripe) {
    const active = checkoutErrorMessage === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE;
    const rolloutPending = checkoutErrorMessage === ROLLOUT_ERROR_MESSAGE;
    const errorTitle = active
      ? "Manage your current plan"
      : rolloutPending
        ? "New subscriptions are temporarily unavailable"
        : "Checkout couldn't load";
    return (
      <div data-checkout-state="error" role="alert" className="p-8 text-center text-sm">
        <p className="font-medium mb-2">{errorTitle}</p>
        <p className="text-muted-foreground">{checkoutErrorMessage ?? CHECKOUT_ERROR_MESSAGE}</p>
        {active ? (
          <Link
            to="/settings/$section"
            params={{ section: "billing" }}
            className="mt-4 inline-flex min-h-11 items-center rounded-full border border-border px-4"
          >
            Open billing settings
          </Link>
        ) : rolloutPending ? (
          <Link
            to="/contact-support"
            className="mt-4 inline-flex min-h-11 items-center rounded-full border border-border px-4"
          >
            Contact support
          </Link>
        ) : (
          <button
            type="button"
            onClick={retry}
            className="mt-4 min-h-11 rounded-full border border-border px-4"
          >
            Retry secure checkout
          </button>
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
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading secure checkout…
        </div>
      )}
      <EmbeddedCheckoutProvider key={attemptKey} stripe={stripe} options={checkoutOptions}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
