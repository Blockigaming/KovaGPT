declare module "@/lib/checkout-return-url.mjs" {
  export function billingReturnUrls(origin: string | undefined): {
    checkout: string;
    portal: string;
  };
  export function billingReturnOriginConfigured(origin: string | undefined): boolean;
}
