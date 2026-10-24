import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import {
  requireMonthlyIntroReadiness,
  reconcileAccountMonthlyIntroCheckout,
} from "@/lib/billing-policy.mjs";
import { runAccountPolicyFinalizerBatch } from "@/lib/account-lifecycle-policy.mjs";
import { finalizeAccountAfterRecovery } from "@/lib/account-deletion-finalizer.server";

/** No user bearer tokens are retained for the 30-day interval. An independently
 * authenticated server worker claims only due accounts from the service-only RPC. */
export async function runAccountDeletionBatch() {
  await requireMonthlyIntroReadiness(supabaseAdmin);
  return runAccountPolicyFinalizerBatch({
    admin: supabaseAdmin,
    limit: 1,
    reconcileCheckout: (userId) =>
      reconcileAccountMonthlyIntroCheckout({
        stripeFactory: (environment: "live" | "sandbox") => createStripeClient(environment),
        supabase: supabaseAdmin,
        userId,
      }),
    finalize: (userId, claim) =>
      finalizeAccountAfterRecovery(
        {
          userId,
          authProvider: "supabase",
          supabaseUser: supabaseAdmin,
          supabaseAdmin,
          emailVerified: false,
          claims: { sub: userId, actor: "account-deletion-worker" },
        },
        claim,
      ),
  });
}
