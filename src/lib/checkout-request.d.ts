declare module "@/lib/checkout-request.mjs" {
  export type CheckoutRequest = Readonly<{
    priceId: string;
    quantity?: 1;
  }>;

  export function parseCheckoutRequest(value: unknown): CheckoutRequest;
}
