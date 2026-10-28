import { createServerFn } from "@tanstack/react-start";
import { loose } from "@/lib/supabase-loose";
import {
  type StripeEnv,
  createStripeClient,
  monthlyIntroBillingEnabled,
} from "@/lib/stripe.server";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { billingReturnOriginConfigured, billingReturnUrls } from "@/lib/checkout-return-url.mjs";
import { parseCheckoutRequest } from "@/lib/checkout-request.mjs";
import { BILLING_ENV, BILLING_PLANS, resolveBillingPlan } from "@/lib/billing-plans";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BillingPolicyError,
  createMonthlyIntroCheckout,
  requireMonthlyIntroReadiness,
} from "@/lib/billing-policy.mjs";

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
    if (!monthlyIntroBillingEnabled())
      return { error: "Billing is awaiting its verified rollout. Contact support." };
    try {
      const plan = resolveBillingPlan(data.priceId);
      if (!plan) throw new Error("Invalid priceId");
      const userId = context.userId;
      const customerEmail =
        typeof context.claims.email === "string" ? context.claims.email : undefined;
      const stripe = createStripeClient(BILLING_ENV);

      // Read every row for an early user-facing check. The adapter also scans
      // authoritative Stripe subscriptions; its durable per-account claim is
      // the concurrency authority for new Checkout requests.
      const { data: subscriptionHistory, error: existingError } = await context.supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", userId)
        .eq("environment", BILLING_ENV)
        .abortSignal(AbortSignal.timeout(10_000));
      if (existingError) {
        return { error: "Billing status couldn't be verified. Try again." };
      }
      // Keep ambiguous periods fail-closed; expired local status must reach the
      // authoritative Stripe scan instead of becoming a permanent stale block.
      if (hasStillActiveSubscription(subscriptionHistory ?? [])) {
        return { error: "You already have an active subscription. Manage it from Billing." };
      }

      const session = await createMonthlyIntroCheckout({
        stripe,
        supabase: supabaseAdmin,
        userId,
        environment: BILLING_ENV,
        email: customerEmail,
        plan,
        couponId: process.env.STRIPE_MONTHLY_INTRO_COUPON_ID,
        returnUrl: billingReturnUrls(process.env.KOVA_BILLING_RETURN_ORIGIN).checkout,
      });

      if (!session.client_secret) {
        throw new Error("Checkout Session client secret missing");
      }
      return { clientSecret: session.client_secret };
    } catch (error) {
      if (error instanceof BillingPolicyError && error.code.includes("active_subscription")) {
        return { error: "You already have an open subscription. Manage it from Billing." };
      }
      if (error instanceof BillingPolicyError && error.code.includes("reconciliation")) {
        return {
          error:
            "Checkout is being reconciled. Retry shortly or contact support; no second payment attempt was started.",
        };
      }
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
    if (!monthlyIntroBillingEnabled())
      return { error: "Billing is awaiting its verified rollout. Contact support." };
    try {
      await requireMonthlyIntroReadiness(supabaseAdmin);
    } catch {
      return { error: "Billing account couldn't be verified. Try again." };
    }
    const { data: mapping, error: mappingError } = await loose(supabaseAdmin)
      .rpc("kova_policy_customer_for_portal", {
        p_user: context.userId,
        p_environment: BILLING_ENV,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (mappingError) {
      return { error: "Billing account couldn't be verified. Try again." };
    }
    if (!mapping?.customerId) {
      return { error: "No billing account found. Start a subscription first." };
    }
    const { data: rows, error: subscriptionError } = await loose(context.supabase)
      .from("subscriptions")
      .select("stripe_customer_id, price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", context.userId)
      .eq("environment", BILLING_ENV)
      .order("created_at", { ascending: false })
      .abortSignal(AbortSignal.timeout(10_000));
    if (subscriptionError) return { error: "Billing account couldn't be verified. Try again." };
    const sub = selectSubscriptionSummaryRow(rows ?? []);
    if (
      sub &&
      hasVerifiedSubscriptionAccess(sub) &&
      sub.stripe_customer_id !== mapping.customerId
    ) {
      return { error: "Billing Customer identity needs reconciliation. Contact support." };
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
        customer: mapping.customerId,
        configuration,
        // The browser cannot choose an arbitrary post-portal redirect.
        return_url: billingReturnUrls(process.env.KOVA_BILLING_RETURN_ORIGIN).portal,
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
  effectiveTier: "free" | "plus" | "pro";
  inherited: boolean;
  activeSubscriptionCount: number;
  billingConflict: boolean;
  billingSetupIncomplete?: boolean;
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
    const { userId } = context;
    // The narrow monthly adapter delegates the existing personal AND shared
    // tier authorities. It never installs the future billing-tier registry or
    // substitutes a personal-price entitlement when shared authority is absent.
    const monthlyPolicy = monthlyIntroBillingEnabled();
    const { data: resolvedSummary, error: summaryError } = await loose(supabaseAdmin)
      .rpc(
        monthlyPolicy ? "kova_monthly_subscription_summary" : "user_subscription_summary",
        monthlyPolicy
          ? {
              p_user: userId,
              p_plus_price: BILLING_PLANS.plus_monthly.livePriceId,
              p_pro_price: BILLING_PLANS.pro_monthly.livePriceId,
            }
          : { _user_id: userId },
      )
      .abortSignal(AbortSignal.timeout(10_000));
    if (
      summaryError ||
      !resolvedSummary ||
      typeof resolvedSummary !== "object" ||
      Array.isArray(resolvedSummary)
    ) {
      throw new Error("Billing details couldn't be verified.");
    }
    const summary = resolvedSummary as Record<string, unknown>;
    const tierValue = summary.tier;
    if (tierValue !== "free" && tierValue !== "plus" && tierValue !== "pro") {
      throw new Error("Billing details couldn't be verified.");
    }
    const tier = tierValue;
    const effectiveTierValue = summary.effectiveTier;
    if (
      effectiveTierValue !== "free" &&
      effectiveTierValue !== "plus" &&
      effectiveTierValue !== "pro"
    ) {
      throw new Error("Billing details couldn't be verified.");
    }
    const effectiveTier = effectiveTierValue;
    const inherited = summary.inherited === true;
    const activeSubscriptionCount =
      typeof summary.activeSubscriptionCount === "number" &&
      Number.isSafeInteger(summary.activeSubscriptionCount) &&
      summary.activeSubscriptionCount >= 0
        ? summary.activeSubscriptionCount
        : null;
    if (activeSubscriptionCount === null) {
      throw new Error("Billing details couldn't be verified.");
    }
    const billingConflict = summary.billingConflict === true;
    const status = typeof summary.status === "string" ? summary.status : null;
    const priceId = typeof summary.priceId === "string" ? summary.priceId : null;
    const currentPeriodEnd =
      typeof summary.currentPeriodEnd === "string" ? summary.currentPeriodEnd : null;
    const cancelAtPeriodEnd = summary.cancelAtPeriodEnd === true;
    const trialing = summary.trialing === true;

    const { data: mapping, error: mappingError } = await loose(supabaseAdmin)
      .from("kova_policy_customer_bindings")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .maybeSingle()
      .abortSignal(AbortSignal.timeout(10_000));
    if (mappingError) {
      // The production billing baseline can temporarily lack this later policy
      // table. Expose the outage only when the authoritative summary has no
      // subscription or paid entitlement; block Checkout and plan changes.
      if (
        ["PGRST205", "42P01"].includes(mappingError.code ?? "") &&
        tier === "free" &&
        effectiveTier === "free" &&
        activeSubscriptionCount === 0 &&
        !billingConflict &&
        !inherited &&
        status === null &&
        priceId === null
      ) {
        return {
          tier: "free",
          effectiveTier: "free",
          inherited: false,
          activeSubscriptionCount: 0,
          billingConflict: true,
          billingSetupIncomplete: true,
          status: null,
          priceId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialing: false,
          hasBillingAccount: false,
          billingPortalAvailable: false,
        };
      }
      throw new Error("Billing details couldn't be verified.");
    }

    const hasBillingAccount = !!mapping?.stripe_customer_id;
    return {
      tier,
      effectiveTier,
      inherited,
      activeSubscriptionCount,
      billingConflict,
      status,
      priceId,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      trialing,
      hasBillingAccount,
      billingPortalAvailable:
        hasBillingAccount &&
        monthlyPolicy &&
        !!billingPortalConfigurationId() &&
        billingReturnOriginConfigured(process.env.KOVA_BILLING_RETURN_ORIGIN),
    };
  });

type CheckoutSubscriptionRow = {
  status: string;
  current_period_end: string | null;
};

type SubscriptionWindowState = "open" | "closed" | "ambiguous";

function subscriptionWindowState(
  subscription: CheckoutSubscriptionRow,
  now = Date.now(),
): SubscriptionWindowState {
  const isPotentiallyCurrent = ["active", "trialing", "past_due", "canceled"].includes(
    subscription.status,
  );
  if (!isPotentiallyCurrent) return "closed";
  if (!subscription.current_period_end) return "ambiguous";
  const periodEnd = new Date(subscription.current_period_end).getTime();
  if (!Number.isFinite(periodEnd)) return "ambiguous";
  return periodEnd > now ? "open" : "closed";
}

function hasVerifiedSubscriptionAccess(
  subscription: CheckoutSubscriptionRow,
  now = Date.now(),
): boolean {
  return subscriptionWindowState(subscription, now) === "open";
}

function hasStillActiveSubscription(
  rows: readonly CheckoutSubscriptionRow[],
  now = Date.now(),
): boolean {
  // Ambiguous current-subscription data blocks another Checkout session but
  // cannot grant paid access through the customer-facing summary.
  return rows.some((subscription) => subscriptionWindowState(subscription, now) !== "closed");
}

type SubscriptionSummaryRow = CheckoutSubscriptionRow & {
  stripe_customer_id: string | null;
  price_id: string | null;
  cancel_at_period_end: boolean | null;
};

function selectSubscriptionSummaryRow(
  rows: readonly SubscriptionSummaryRow[],
  now = Date.now(),
): SubscriptionSummaryRow | null {
  return (
    rows.find((subscription) => hasVerifiedSubscriptionAccess(subscription, now)) ?? rows[0] ?? null
  );
}
