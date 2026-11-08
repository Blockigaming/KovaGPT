export type KovaCustomerModel = Readonly<{
  id: import("../consumer-model-selection.mjs").ConsumerModelId;
  name: string;
  tier: "flagship" | "balanced" | "fast";
  purpose: string;
}>;

export const KOVA_MODEL_CATALOG: Readonly<{
  xenon: KovaCustomerModel;
  neon: KovaCustomerModel;
  argon: KovaCustomerModel;
  [key: string]: KovaCustomerModel;
}>;
export const KOVA_SELF_HOSTED_DEFAULT_ENABLED: false;
export function resolveKovaModelAlias(alias: unknown): KovaCustomerModel | null;
export function eligibleForSelfHosted(options?: {
  enabled?: boolean;
  healthy?: boolean;
  requiredCapabilities?: string[];
  verifiedCapabilities?: string[];
}): boolean;
