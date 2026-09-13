export type DiscoveryMode = "web" | "images" | "shopping" | "local";
export type DiscoveryResult = {
  url: string;
  title: string;
  snippet: string;
  source: string;
  observedAt: string;
  imageUrl?: string;
  sourceToken?: string;
};
export type DiscoveryVariant = {
  ordinal: number;
  id: string;
  sku: string;
  title: string;
  values: Record<string, string>;
  price: { amount: number; currency: string } | null;
  inStock: boolean | null;
};
export type DiscoveryProduct = {
  status: string;
  sourceUrl: string;
  url?: string;
  title?: string;
  brand?: string;
  observedAt: string;
  variants: DiscoveryVariant[];
};
export type DiscoveryConfig = {
  enabled: boolean;
  apiKey: string;
  signingSecret: string;
  globalDailyLimit: number | null;
  userDailyLimit: number | null;
};
export const DISCOVERY_MODES: readonly DiscoveryMode[];
export function publicDiscoveryUrl(value: unknown): string | null;
export function discoveryConfiguration(env: Record<string, string | undefined>): DiscoveryConfig;
export function discoveryInput(
  value: unknown,
):
  | { operation: "product"; sourceToken: string }
  | { operation: "search"; mode: DiscoveryMode; query: string; location: string };
export function normalizeDiscoverySearch(
  payload: unknown,
  mode: DiscoveryMode,
  observedAt: string,
): DiscoveryResult[];
export function normalizeDiscoveryProduct(
  payload: unknown,
  requestedUrl: string,
  observedAt: string,
): DiscoveryProduct;
export function localMapHandoff(query: string, location: string): string;
export function discoveryComparisonKey(
  product: DiscoveryProduct,
  variant: DiscoveryVariant,
): string;
