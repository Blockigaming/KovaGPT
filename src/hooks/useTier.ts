// Client-side tier helper. Reads the user's most recent active subscription
// row from Supabase (RLS scoped to auth.uid()) and resolves to free/plus/pro.
import { useEffect, useState } from "react";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { BILLING_ENV, tierForLookupKey, type BillingTier } from "@/lib/billing-plans";

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
      const uid = userRes.user?.id;
      if (!uid) {
        if (alive) {
          setTier("free");
          setLoading(false);
        }
        return;
      }
      const resolveFor = async (targetUid: string): Promise<Tier> => {
        const { data } = await supabase
          .from("subscriptions")
          .select("price_id, status, current_period_end")
          .eq("user_id", targetUid)
          .eq("environment", BILLING_ENV)
          .order("created_at", { ascending: false })
          .limit(5);
        const now = Date.now();
        let resolved: Tier = "free";
        for (const row of data ?? []) {
          const end = row.current_period_end ? new Date(row.current_period_end).getTime() : 0;
          const active =
            (["active", "trialing", "past_due"].includes(row.status) &&
              (!row.current_period_end || end > now)) ||
            (row.status === "canceled" && end > now);
          if (!active) continue;
          const t = tierForLookupKey(row.price_id);
          if (t === "pro") return "pro";
          if (t === "plus") resolved = "plus";
        }
        return resolved;
      };

      let resolved = await resolveFor(uid);

      // Family Sharing: if the user is a member of a family group, inherit
      // the owner's plan when it is higher than their own.
      if (resolved !== "pro") {
        const { data: ownerId } = await supabase.rpc("family_owner_of", { _user_id: uid });
        if (typeof ownerId === "string" && ownerId && ownerId !== uid) {
          const ownerTier = await resolveFor(ownerId);
          if (ownerTier === "pro") resolved = "pro";
          else if (ownerTier === "plus" && resolved === "free") resolved = "plus";
        }
      }

      if (!alive) return;
      setTier(resolved);
      setLoading(false);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        load();
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { tier, loading };
}

export function tierRank(t: Tier): number {
  return t === "pro" ? 2 : t === "plus" ? 1 : 0;
}
