export declare const CHECKOUT_ORIGIN_MAX_AGE_MS: number;
export declare function checkoutOriginKey(userId: unknown): string | null;
export declare function activeCheckoutOrigin(
  value: unknown,
  ownerId: string | null | undefined,
  now?: number,
): boolean;
