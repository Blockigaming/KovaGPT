export type GrowthEventName =
  | "onboarding_viewed"
  | "onboarding_completed"
  | "onboarding_skipped"
  | "pricing_viewed"
  | "upgrade_prompt_viewed"
  | "upgrade_started"
  | "checkout_opened"
  | "checkout_completed"
  | "checkout_failed"
  | "payment_recovery_viewed"
  | "payment_recovery_started"
  | "subscription_cancel_started"
  | "subscription_cancel_feedback"
  | "subscription_cancelled"
  | "referral_landed"
  | "referral_signup"
  | "feature_used"
  | "feature_before_upgrade";

export type GrowthEventMetadata = {
  feature?: string;
  surface?: string;
  plan?: string;
  reason?: string;
  referralCode?: string;
  campaign?: string;
};

const ALLOWED_KEYS = new Set(["feature", "surface", "plan", "reason", "referralCode", "campaign"]);

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export function sanitizeGrowthMetadata(input: GrowthEventMetadata = {}): GrowthEventMetadata {
  const clean: GrowthEventMetadata = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    const value = bounded(raw, key === "reason" ? 160 : 80);
    if (value) {
      (clean as Record<string, string>)[key] = value;
    }
  }

  return clean;
}

export async function recordGrowthEvent(
  name: GrowthEventName,
  metadata: GrowthEventMetadata = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  if (navigator.doNotTrack === "1") return;

  const detail = {
    name,
    metadata: sanitizeGrowthMetadata(metadata),
  };

  try {
    window.dispatchEvent(new CustomEvent("kova:growth-event", { detail }));

    /*
     * PlatformRuntime owns durable operational analytics flushing.
     * This DOM event is intentionally content-free and gives the
     * analytics runtime a stable growth/conversion seam without
     * coupling product actions to analytics availability.
     */
  } catch {
    // Analytics must never block the action that caused the event.
  }
}

export function readReferralAttribution(): GrowthEventMetadata {
  if (typeof window === "undefined") return {};

  const url = new URL(window.location.href);

  return sanitizeGrowthMetadata({
    referralCode: url.searchParams.get("ref") ?? undefined,
    campaign: url.searchParams.get("utm_campaign") ?? url.searchParams.get("campaign") ?? undefined,
  });
}
