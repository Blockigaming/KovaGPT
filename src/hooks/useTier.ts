// Client-side tier helper. Reads the user's most recent active subscription
// row from Supabase (RLS scoped to auth.uid()) and resolves to free/plus/pro.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Tier = "free" | "plus" | "pro";

function classify(priceId: string | null | undefined): Tier {
  const id = (priceId ?? "").toLowerCase();
  if (id.includes("pro")) return "pro";
  if (id.includes("plus")) return "plus";
  return "free";
}

export function useTier(): { tier: Tier; loading: boolean } {
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
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
      const { data } = await supabase
        .from("subscriptions")
        .select("price_id, status, current_period_end")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(5);
      if (!alive) return;
      const now = Date.now();
      let resolved: Tier = "free";
      for (const row of data ?? []) {
        const end = row.current_period_end ? new Date(row.current_period_end).getTime() : 0;
        const active =
          (["active", "trialing", "past_due"].includes(row.status) &&
            (!row.current_period_end || end > now)) ||
          (row.status === "canceled" && end > now);
        if (!active) continue;
        const t = classify(row.price_id);
        if (t === "pro") {
          resolved = "pro";
          break;
        }
        if (t === "plus") resolved = "plus";
      }
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
