import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveEffectiveBillingTier } from "@/lib/billing-entitlement.server";

/** Plan display does not depend on Checkout or a payment-customer mapping. */
export const getMyPlanTier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { ownerId: string }) => {
    if (!data || typeof data.ownerId !== "string" || !data.ownerId || data.ownerId.length > 128)
      throw new Error("Invalid account.");
    return data;
  })
  .handler(async ({ context, data }) => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed. Reload and retry.");
    return {
      ownerId: context.userId,
      tier: await resolveEffectiveBillingTier(supabaseAdmin, context.userId),
    };
  });
