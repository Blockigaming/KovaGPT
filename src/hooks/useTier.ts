// Client display helper. Authorization remains server-side; this cached label
// comes from an authenticated wrapper around the exact database resolver.
import { useEffect, useState } from "react";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import type { BillingTier } from "@/lib/billing-plans";

export type Tier = BillingTier;

export function useTier(): { tier: Tier; loading: boolean } {
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const config = getSupabaseClientConfigStatus();
    if (!config.configured) {
      setTier("free");
      setLoading(false);
      return;
    }

    const load = async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        if (alive) {
          setTier("free");
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.rpc("current_subscription_summary");
      const summary =
        !error && data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;
      const effectiveTier = summary?.effectiveTier;
      const resolved: Tier =
        summary?.billingConflict !== true && (effectiveTier === "plus" || effectiveTier === "pro")
          ? effectiveTier
          : "free";
      if (!alive) return;
      setTier(resolved);
      setLoading(false);
    };

    load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        load();
      }
    });
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { tier, loading };
}

export function tierRank(tier: Tier): number {
  return tier === "pro" ? 2 : tier === "plus" ? 1 : 0;
}
