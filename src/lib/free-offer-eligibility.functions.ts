import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loose } from "@/lib/supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BILLING_ENV, BILLING_PLANS } from "@/lib/billing-plans";
import { createStripeClient, monthlyIntroBillingEnabled } from "@/lib/stripe.server";
import {
  canDisplayFreeIntroOffer,
  isConfirmedIntroOfferIneligible,
  isVerifiedFirstMonthCoupon,
} from "./free-offer-eligibility-policy.mjs";

type IntroEligibility =
  { eligible: true } | { eligible: false; reason: "ineligible" | "unavailable" };
const unavailable = { eligible: false, reason: "unavailable" } as const;

/**
 * This endpoint is a conservative UI-visibility precheck, NOT a coupon grant.
 * The existing billing claim + Stripe Checkout policy remains authoritative.
 * Returns false on missing migration, pending settlement, or uncertain state.
 */
export const getFreeOfferEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ expectedOwnerId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<IntroEligibility> => {
    if (
      data.expectedOwnerId !== context.userId ||
      !monthlyIntroBillingEnabled() ||
      !process.env.STRIPE_MONTHLY_INTRO_COUPON_ID
    ) {
      return unavailable;
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
      if (summaryResult.error || redemption.error || pending.error) return unavailable;
      const summary = summaryResult.data as Record<string, unknown> | null;
      const redeemed = Boolean(redemption.data?.length);
      if (isConfirmedIntroOfferIneligible(summary, redeemed))
        return { eligible: false, reason: "ineligible" };
      const eligible = canDisplayFreeIntroOffer({
        summary,
        redeemed,
        pendingClaim: Boolean(pending.data?.length),
        billingEnabled: monthlyIntroBillingEnabled(),
        couponConfigured: Boolean(process.env.STRIPE_MONTHLY_INTRO_COUPON_ID),
      });
      if (!eligible) return unavailable;
      // Check the actual Stripe coupon instead of trusting a configured ID.
      // Checkout independently revalidates redemption and entitlement.
      const coupon = await createStripeClient(BILLING_ENV).coupons.retrieve(
        process.env.STRIPE_MONTHLY_INTRO_COUPON_ID!,
      );
      return isVerifiedFirstMonthCoupon(coupon) ? { eligible: true } : unavailable;
    } catch {
      return unavailable;
    }
  });
