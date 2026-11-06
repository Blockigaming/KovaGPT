export type KovaCustomerModel = Readonly<{
  id: "kova-xenon-5" | "kova-neon-4.6" | "kova-argon-4.6";
  name: "Kova Xenon 5" | "Kova Neon 4.6" | "Kova Argon 4.6";
  tier: "flagship" | "balanced" | "fast";
  purpose: string;
}>;

export const KOVA_MODEL_CATALOG: Readonly<{
  xenon: KovaCustomerModel;
  neon: KovaCustomerModel;
  argon: KovaCustomerModel;
}>;
export const KOVA_SELF_HOSTED_DEFAULT_ENABLED: false;
export function resolveKovaModelAlias(alias: unknown): KovaCustomerModel | null;
export function eligibleForSelfHosted(options?: {
  enabled?: boolean;
  healthy?: boolean;
  requiredCapabilities?: string[];
  verifiedCapabilities?: string[];
}): boolean;
