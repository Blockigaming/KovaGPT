// Display only: every paid operation still verifies its tier on the server.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { getMyPlanTier } from "@/utils/plan.functions";
import type { BillingTier } from "@/lib/billing-plans";

export type Tier = BillingTier;
export type TierDisplayStatus = "loading" | "ready" | "unavailable" | "signed_out";
type Snapshot = { owner: string | null; tier: Tier; status: TierDisplayStatus };
const verified = new Map<string, { tier: Tier; until: number }>();
const pending = new Map<string, Promise<Tier>>();

export function useTier(): { tier: Tier; loading: boolean; status: TierDisplayStatus } {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const read = useServerFn(getMyPlanTier);
  const readRef = useRef(read);
  readRef.current = read;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    owner: null,
    tier: "free",
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    let generation = 0;
    if (!isLoaded || !owner) {
      setSnapshot({ owner, tier: "free", status: isLoaded ? "signed_out" : "loading" });
      return;
    }
    const load = async (force = false) => {
      const request = ++generation;
      const current = () => active && request === generation;
      const cached = verified.get(owner);
      if (!force && cached && cached.until > Date.now()) {
        setSnapshot({ owner, tier: cached.tier, status: "ready" });
        return;
      }
      try {
        let operation = pending.get(owner);
        if (!operation) {
          operation = readRef
            .current({ data: { ownerId: owner } })
            .then((summary) => {
              if (summary.ownerId !== owner) throw new Error("Your account changed");
              const tier = summary.tier;
              if (tier !== "free" && tier !== "plus" && tier !== "pro")
                throw new Error("Invalid plan response");
              verified.set(owner, { tier, until: Date.now() + 60_000 });
              return tier;
            })
            .finally(() => pending.delete(owner));
          pending.set(owner, operation);
        }
        const tier = await operation;
        if (current()) setSnapshot({ owner, tier, status: "ready" });
      } catch {
        if (current()) setSnapshot({ owner, tier: "free", status: "unavailable" });
      }
    };
    const refresh = () => {
      void load(true);
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("kova-plan-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    // Supabase holds an auth lock while dispatching. Never read auth or issue
    // another session-dependent request synchronously from this callback.
    const subscription = getSupabaseClientConfigStatus().configured
      ? supabase.auth.onAuthStateChange(() =>
          queueMicrotask(() => {
            if (active) refresh();
          }),
        ).data.subscription
      : null;
    return () => {
      active = false;
      generation++;
      subscription?.unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("kova-plan-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [owner, isLoaded]);

  const current =
    snapshot.owner === owner ? snapshot : { tier: "free" as const, status: "loading" as const };
  return { tier: current.tier, loading: current.status === "loading", status: current.status };
}

export function tierRank(tier: Tier): number {
  return tier === "pro" ? 2 : tier === "plus" ? 1 : 0;
}
