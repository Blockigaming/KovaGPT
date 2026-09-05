export function canonicalPricingJson(value: unknown): string;
export function validatePricingProposal(
  raw: unknown,
  now?: number,
): {
  proposal: Record<string, unknown>;
  canonical: string;
  quotes: {
    publicModel: string;
    capability: string;
    maximumReservedCharge: unknown;
    currency: string;
  }[];
};
export function pricingRegistryIds(version: unknown): string[];
export function validateCreditOfferProposal(
  raw: unknown,
  now?: number,
): ReturnType<typeof validatePricingProposal>;
export function verifyCreditOfferPrice(
  proposal: Record<string, unknown>,
  price: unknown,
  registrations?: unknown[],
  taxSettings?: unknown,
  account?: unknown,
): void;
