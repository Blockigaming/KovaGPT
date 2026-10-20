import type { SupabaseClient } from "@supabase/supabase-js";
import { loose } from "@/lib/supabase-loose";
import type { Database } from "@/integrations/supabase/types";
import type { BillingTier } from "@/lib/billing-plans";

export class BillingEntitlementUnavailableError extends Error {
  readonly code = "billing_entitlement_unavailable";
  readonly status = 503;
  readonly retryable = true;
  readonly publicMessage = "Your plan could not be verified. Please try again shortly.";

  constructor() {
    super("billing_entitlement_unavailable");
    this.name = "BillingEntitlementUnavailableError";
  }
}

async function resolveTier(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  routine: "billing_user_plan_tier" | "effective_user_plan_tier",
): Promise<BillingTier> {
  let result: { data: unknown; error: unknown };
  try {
    result = await loose(supabaseAdmin)
      .rpc(routine, { _user_id: userId })
      .abortSignal(AbortSignal.timeout(10_000));
  } catch {
    // A missing RPC, transport failure or timeout is not evidence of Free.
    // Do not include a database error, response body or identity in diagnostics.
    throw new BillingEntitlementUnavailableError();
  }
  if (
    !result ||
    result.error !== null ||
    (result.data !== "free" && result.data !== "plus" && result.data !== "pro")
  ) {
    throw new BillingEntitlementUnavailableError();
  }
  return result.data;
}

export async function resolveUserBillingTier(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<BillingTier> {
  return resolveTier(supabaseAdmin, userId, "billing_user_plan_tier");
}

export async function resolveEffectiveBillingTier(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<BillingTier> {
  return resolveTier(supabaseAdmin, userId, "effective_user_plan_tier");
}
