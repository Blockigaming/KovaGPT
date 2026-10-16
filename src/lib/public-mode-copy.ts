import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import type { ModeId } from "@/lib/modes";

const PLAN_TIERS = ["free", "plus", "pro"] as const;

// Public copy follows the same per-plan labels as the entitlement-backed registry.
// Labels describe plan policy, not verification of a serving model or provider.
export const PUBLIC_MODE_PLAN_SUMMARY = PLAN_TIERS.map(
  (tier) =>
    `${CAPABILITY_REGISTRY.plans[tier].name} includes ${CAPABILITY_REGISTRY.modesByTier[tier]
      .map((mode) => mode.label)
      .join(", ")}.`,
).join(" ");

export function publicModeLabel(modeId: ModeId): string {
  const entries = PLAN_TIERS.flatMap((tier) => {
    const mode = CAPABILITY_REGISTRY.modesByTier[tier].find((entry) => entry.id === modeId);
    return mode ? [{ label: mode.label, plan: CAPABILITY_REGISTRY.plans[tier].name }] : [];
  });
  if (new Set(entries.map((entry) => entry.label)).size <= 1)
    return entries[0]?.label ?? "Not included in current plans";
  return entries.map((entry) => `${entry.label} (${entry.plan})`).join(" / ");
}
