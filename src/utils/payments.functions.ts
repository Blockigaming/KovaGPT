import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient } from "@/lib/stripe.server";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { CHECKOUT_RETURN_URL } from "@/lib/checkout-return-url.mjs";
import { parseCheckoutRequest } from "@/lib/checkout-request.mjs";
import { BILLING_ENV, resolveBillingPlan, tierForLookupKey } from "@/lib/billing-plans";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveStripeCustomerId } from "@/lib/stripe-customer-mapping.mjs";

type CheckoutSessionResult = { clientSecret: string } | { error: string };
// Customer-facing billing is production-only. The environment supplied by a
// browser is never trusted to select Stripe credentials or subscription rows.

export function billingPortalConfigurationId(): string | null {
  const value = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  return value && /^bpc_[a-zA-Z0-9]+$/u.test(value) ? value : null;
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const parsed = parseCheckoutRequest(data);
    if (!resolveBillingPlan(parsed.priceId)) throw new Error("Invalid priceId");
    return parsed;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const plan = resolveBillingPlan(data.priceId);
      if (!plan) throw new Error("Invalid priceId");
      const userId = context.userId;
      const customerEmail =
        typeof context.claims.email === "string" ? context.claims.email : undefined;
      const stripe = createStripeClient(BILLING_ENV);

      // Prevent duplicate active subscriptions for the same user in this env.
      const { data: existing, error: existingError } = await context.supabase
        .from("subscriptions")
        .select("status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .eq("environment", BILLING_ENV)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) {
        return { error: "Billing status couldn't be verified. Try again." };
      }
      if (existing) {
        const periodEnd = existing.current_period_end
          ? new Date(existing.current_period_end).getTime()
          : 0;
        const stillActive =
          (["active", "trialing", "past_due"].includes(existing.status) &&
            (!existing.current_period_end || periodEnd > Date.now())) ||
          (existing.status === "canceled" && periodEnd > Date.now());
        if (stillActive && !existing.cancel_at_period_end) {
          return {
            error:
              "You already have an active subscription. Manage your plan from the billing portal before starting a new one.",
          };
        }
      }

      const prices = await stripe.prices.list({
        lookup_keys: [plan.lookupKey],
        active: true,
        limit: 1,
      });
      const stripePrice = prices.data[0];
      if (
        !stripePrice ||
        stripePrice.lookup_key !== plan.lookupKey ||
        stripePrice.type !== "recurring"
      ) {
        throw new Error("Price not found");
      }

      const customerId = await resolveStripeCustomerId({
        stripe,
        supabase: supabaseAdmin,
        environment: BILLING_ENV,
        userId,
        email: customerEmail,
      });

      // Free-trial eligibility for Plus. A user is eligible only if they have
      // no subscription row and their mapped Stripe Customer has no history.
      let isPlusTrialEligible = plan.trialPeriodDays > 0 && !existing;
      if (isPlusTrialEligible) {
        const prior = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 1,
        });
        if (prior.data.length > 0) isPlusTrialEligible = false;
      }

      const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
        integration_identifier: "kovagpt_checkout_wshrfyef",
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: CHECKOUT_RETURN_URL,
        managed_payments: { enabled: true },
        customer: customerId,
        metadata: { userId },
        subscription_data: {
          metadata: { userId },
          ...(isPlusTrialEligible && {
            trial_period_days: plan.trialPeriodDays,
          }),
        },
      };
      const session = await stripe.checkout.sessions.create(sessionParams);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("[billing-checkout] Stripe request failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return { error: "Checkout is unavailable right now. Try again." };
    }
  });

type PortalResult = { url: string } | { error: string };

// Opens an explicitly configured Stripe Billing Portal. The internal mapping,
// not an email or browser-provided value, is the customer identity authority.
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: Record<string, never>) => data)
  .handler(async ({ context }): Promise<PortalResult> => {
    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("stripe_customer_mappings")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .eq("environment", BILLING_ENV)
      .maybeSingle();
    if (mappingError) {
      return { error: "Billing account couldn't be verified. Try again." };
    }
    if (!mapping?.stripe_customer_id) {
      return { error: "No billing account found. Start a subscription first." };
    }
    const configuration = billingPortalConfigurationId();
    if (!configuration) {
      return {
        error: "The billing portal is not configured. Contact support for billing help.",
      };
    }
    try {
      const stripe = createStripeClient(BILLING_ENV);
      const portal = await stripe.billingPortal.sessions.create({
        customer: mapping.stripe_customer_id,
        configuration,
        // The browser cannot choose an arbitrary post-portal redirect.
        return_url: "https://kovagpt.com/",
      });
      const portalUrl = parseAllowedBillingPortalUrl(portal.url);
      if (!portalUrl) {
        console.error("[billing-portal] Stripe returned a URL outside the allowlist");
        return {
          error: "The billing portal is unavailable right now. Try again.",
        };
      }
      return { url: portalUrl };
    } catch (error) {
      console.error("[billing-portal] Stripe request failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return {
        error: "The billing portal is unavailable right now. Try again.",
      };
    }
  });

export type SubscriptionSummary = {
  tier: "free" | "plus" | "pro";
  status: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialing: boolean;
  hasBillingAccount: boolean;
  billingPortalAvailable: boolean;
};

// Server-verified subscription summary for the current user. Subscription rows
// are RLS-scoped; customer identity is read from the server-only mapping table.
export const getSubscriptionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) => data)
  .handler(async ({ context }): Promise<SubscriptionSummary> => {
    const { supabase, userId } = context;
    const { data: row, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) {
      throw new Error("Billing details couldn't be verified.");
    }
    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("stripe_customer_mappings")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .maybeSingle();
    if (mappingError) throw new Error("Billing details couldn't be verified.");

    const priceId = row?.price_id ?? null;
    const now = Date.now();
    const end = row?.current_period_end ? new Date(row.current_period_end).getTime() : 0;
    const active =
      !!row &&
      ((["active", "trialing", "past_due"].includes(row.status) &&
        (!row.current_period_end || end > now)) ||
        (row.status === "canceled" && end > now));
    const tier = active ? tierForLookupKey(priceId) : "free";
    const hasBillingAccount = !!mapping?.stripe_customer_id;
    return {
      tier,
      status: row?.status ?? null,
      priceId,
      currentPeriodEnd: row?.current_period_end ?? null,
      cancelAtPeriodEnd: !!row?.cancel_at_period_end,
      trialing: row?.status === "trialing",
      hasBillingAccount,
      billingPortalAvailable: hasBillingAccount && !!billingPortalConfigurationId(),
    };
  });
