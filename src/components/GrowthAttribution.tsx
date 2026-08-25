import { useEffect } from "react";
import { readReferralAttribution, recordGrowthEvent } from "@/lib/growth-events";

export function GrowthAttribution() {
  useEffect(() => {
    const attribution = readReferralAttribution();

    if (!attribution.referralCode && !attribution.campaign) {
      return;
    }

    void recordGrowthEvent("referral_landed", attribution);
  }, []);

  return null;
}
