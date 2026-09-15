export type EntitlementTier = "free" | "plus" | "pro";
export type EntitledModeId =
  "instant" | "medium" | "thinking" | "high" | "extra_high" | "max" | "ultra";

export const MODE_IDS_BY_TIER: Readonly<Record<EntitlementTier, readonly EntitledModeId[]>>;
export function isModeAllowedForTier(tier: EntitlementTier, modeId: string): boolean;
