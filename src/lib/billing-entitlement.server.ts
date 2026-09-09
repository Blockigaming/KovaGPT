import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BillingTier } from "@/lib/billing-plans";

function normalizeTier(value: unknown): BillingTier {
  return value === "plus" || value === "pro" ? value : "free";
}

export async function resolveUserBillingTier(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<BillingTier> {
  const { data, error } = await supabaseAdmin.rpc("billing_user_plan_tier", {
    _user_id: userId,
  });
  if (error) {
    console.error("[billing-entitlement] user tier lookup failed");
    return "free";
  }
  return normalizeTier(data);
}

export async function resolveEffectiveBillingTier(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<BillingTier> {
  const { data, error } = await supabaseAdmin.rpc("effective_user_plan_tier", {
    _user_id: userId,
  });
  if (error) {
    console.error("[billing-entitlement] effective tier lookup failed");
    return "free";
  }
  return normalizeTier(data);
}
