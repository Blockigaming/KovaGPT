// Client display helper. Authorization remains server-side; this cached label
// comes from an authenticated wrapper around the exact database resolver.
import { useEffect, useState } from "react";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { loose } from "@/lib/supabase-loose";
import type { BillingTier } from "@/lib/billing-plans";

export type Tier = BillingTier;

export type TierDisplayStatus = "loading" | "ready" | "unavailable" | "signed_out";

export function useTier(): { tier: Tier; loading: boolean; status: TierDisplayStatus } {
  // Keep the conservative tier fallback for existing consumers. Only a verified
  // summary may be presented as a known subscription label.
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TierDisplayStatus>("loading");

  useEffect(() => {
    let alive = true;
    let generation = 0;
    const config = getSupabaseClientConfigStatus();
    if (!config.configured) {
      setTier("free");
      setLoading(false);
      setStatus("unavailable");
      return;
    }

    const load = async () => {
      const request = ++generation;
      const current = () => alive && request === generation;
      setTier("free");
      setLoading(true);
      setStatus("loading");
      try {
        const { data: userRes, error: userError } = await supabase.auth.getUser();
        if (!current()) return;
        if (userError || !userRes.user) {
          setStatus(userError ? "unavailable" : "signed_out");
          setLoading(false);
          return;
        }
        const { data, error } = await loose(supabase).rpc("current_subscription_summary");
        if (!current()) return;
        const summary =
          !error && data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;
        const effectiveTier = summary?.effectiveTier;
        const known =
          effectiveTier === "free" || effectiveTier === "plus" || effectiveTier === "pro";
        setTier(known ? effectiveTier : "free");
        setStatus(known ? "ready" : "unavailable");
        setLoading(false);
      } catch {
        if (!current()) return;
        setTier("free");
        setStatus("unavailable");
        setLoading(false);
      }
    };

    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void load();
      }
    });
    return () => {
      alive = false;
      generation++;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { tier, loading, status };
}

export function tierRank(tier: Tier): number {
  return tier === "pro" ? 2 : tier === "plus" ? 1 : 0;
}
