import { lazy, Suspense, useCallback, useState } from "react";

const StripeEmbeddedCheckout = lazy(async () => {
  const checkout = await import("@/components/StripeEmbeddedCheckout");
  return { default: checkout.StripeEmbeddedCheckout };
});

interface CheckoutOptions {
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId?: string;
}

export function useStripeCheckout() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CheckoutOptions | null>(null);

  const openCheckout = useCallback((opts: CheckoutOptions) => {
    setOptions(opts);
    setIsOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setIsOpen(false);
    setOptions(null);
  }, []);

  const checkoutElement =
    isOpen && options ? (
      <Suspense fallback={<p role="status">Loading secure checkout…</p>}>
        <StripeEmbeddedCheckout {...options} />
      </Suspense>
    ) : null;

  return { openCheckout, closeCheckout, isOpen, checkoutElement };
}
