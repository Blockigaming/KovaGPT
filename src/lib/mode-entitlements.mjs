/** Canonical current-generation mode entitlements. Keep UI and server guards on this policy. */
export const MODE_IDS_BY_TIER = Object.freeze({
  free: Object.freeze(["instant", "thinking"]),
  plus: Object.freeze(["instant", "medium", "high"]),
  pro: Object.freeze(["instant", "medium", "high", "extra_high", "max", "ultra"]),
});

export function isModeAllowedForTier(tier, modeId) {
  return (
    Object.prototype.hasOwnProperty.call(MODE_IDS_BY_TIER, tier) &&
    MODE_IDS_BY_TIER[tier].includes(modeId)
  );
}
