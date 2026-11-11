import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loose } from "@/lib/supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BILLING_ENV, BILLING_PLANS } from "@/lib/billing-plans";
import { createStripeClient, monthlyIntroBillingEnabled } from "@/lib/stripe.server";
import {
  canDisplayFreeIntroOffer,
  isVerifiedFirstMonthCoupon,
} from "./free-offer-eligibility-policy.mjs";

/**
 * This endpoint is a conservative UI-visibility precheck, NOT a coupon grant.
 * The existing billing claim + Stripe Checkout policy remains authoritative.
 * Returns false on missing migration, pending settlement, or uncertain state.
 */
export const getFreeOfferEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ eligible: boolean }> => {
    if (!monthlyIntroBillingEnabled() || !process.env.STRIPE_MONTHLY_INTRO_COUPON_ID) {
      return { eligible: false };
    }
    const owner = context.userId;
    const db = loose(supabaseAdmin);
    try {
      const [summaryResult, redemption, pending] = await Promise.all([
        db
          .rpc("kova_monthly_subscription_summary", {
            p_user: owner,
            p_plus_price: BILLING_PLANS.plus_monthly.livePriceId,
            p_pro_price: BILLING_PLANS.pro_monthly.livePriceId,
          })
          .abortSignal(AbortSignal.timeout(10000)),
        db
          .from("kova_policy_intro_redemptions")
          .select("user_id")
          .eq("user_id", owner)
          .limit(1)
          .abortSignal(AbortSignal.timeout(10000)),
        db
          .from("kova_policy_checkout_claims")
          .select("id")
          .eq("user_id", owner)
          .in("state", ["pending", "open"])
          .limit(1)
          .abortSignal(AbortSignal.timeout(10000)),
      ]);
      if (summaryResult.error || redemption.error || pending.error) return { eligible: false };
      const summary = summaryResult.data as Record<string, unknown> | null;
      const eligible = canDisplayFreeIntroOffer({
        summary,
        redeemed: Boolean(redemption.data?.length),
        pendingClaim: Boolean(pending.data?.length),
        billingEnabled: monthlyIntroBillingEnabled(),
        couponConfigured: Boolean(process.env.STRIPE_MONTHLY_INTRO_COUPON_ID),
      });
      if (!eligible) return { eligible: false };
      // Check the actual Stripe coupon instead of trusting a configured ID.
      // Checkout independently revalidates redemption and entitlement.
      const coupon = await createStripeClient(BILLING_ENV).coupons.retrieve(
        process.env.STRIPE_MONTHLY_INTRO_COUPON_ID!,
      );
      return { eligible: isVerifiedFirstMonthCoupon(coupon) };
    } catch {
      return { eligible: false };
    }
  });
