declare module "@/lib/checkout-return-url.mjs" {
  export const CHECKOUT_RETURN_URL: string;
  export function parseAllowedCheckoutReturnUrl(value: unknown): string;
}
