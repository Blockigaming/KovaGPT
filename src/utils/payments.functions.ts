import { createServerFn } from "@tanstack/react-start";
import {
  type StripeEnv,
  createStripeClient,
  durableStripeBillingEnabled,
} from "@/lib/stripe.server";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { CHECKOUT_RETURN_URL } from "@/lib/checkout-return-url.mjs";
import { parseCheckoutRequest } from "@/lib/checkout-request.mjs";
import { BILLING_ENV, resolveBillingPlan } from "@/lib/billing-plans";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveStripeCustomerId } from "@/lib/stripe-customer-mapping.mjs";
import {
  resolveDurableCheckoutSession,
  StripeCheckoutPendingError,
} from "@/lib/stripe-checkout-reconciliation.mjs";
import { stripeSubscriptionBlocksCheckout } from "@/lib/stripe-subscription-status.mjs";

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
    if (!durableStripeBillingEnabled())
      return { error: "Billing is awaiting its verified rollout. Contact support." };
    try {
      const plan = resolveBillingPlan(data.priceId);
      if (!plan) throw new Error("Invalid priceId");
      const userId = context.userId;
      const customerEmail =
        typeof context.claims.email === "string" ? context.claims.email : undefined;
      const stripe = createStripeClient(BILLING_ENV);

      // Read every row for an early user-facing check. The checkout-attempt
      // RPC below is the concurrency authority and repeats this invariant while
      // holding the durable per-user attempt row.
      const { data: subscriptionHistory, error: existingError } = await context.supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", userId)
        .eq("environment", BILLING_ENV);
      if (existingError) {
        return { error: "Billing status couldn't be verified. Try again." };
      }
      // Keep ambiguous periods fail-closed; expired local status must reach the
      // authoritative Stripe scan instead of becoming a permanent stale block.
      if (hasStillActiveSubscription(subscriptionHistory ?? [])) {
        return { error: "You already have an active subscription. Manage it from Billing." };
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
        stripePrice.id !== plan.livePriceId ||
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

      // The database check is concurrency-safe, while this authoritative
      // Customer read closes the webhook-lag window before a new Session exists.
      // Scheduled cancellations remain Stripe "active" and must still block.
      const nowSeconds = Math.floor(Date.now() / 1000);
      let stripeHasHistory = false;
      let stripeHasBlockingSubscription = false;
      for await (const subscription of stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      })) {
        stripeHasHistory = true;
        if (stripeSubscriptionBlocksCheckout(subscription, nowSeconds)) {
          stripeHasBlockingSubscription = true;
          break;
        }
      }
      if (stripeHasBlockingSubscription) {
        return {
          error:
            "You already have an open subscription. Resume or manage it in Billing, or wait until it expires before starting another.",
        };
      }

      const requestedTrialEligibility =
        plan.trialPeriodDays > 0 && (subscriptionHistory ?? []).length === 0 && !stripeHasHistory;

      // The existing promise is a 30-day first-eligible Plus trial. Customer
      // deletion removes the former email/history signal. Until the owner
      // approves its replacement retention policy, never silently sell a
      // no-trial plan or grant a second trial under an unverified identity.
      if (requestedTrialEligibility) {
        return {
          error:
            "Your 30-day trial eligibility needs verification. Contact support before starting Checkout.",
        };
      }

      const { data: checkoutAttempt, error: checkoutAttemptError } = await supabaseAdmin.rpc(
        "claim_stripe_checkout_attempt",
        {
          _user_id: userId,
          _environment: BILLING_ENV,
          _price_id: stripePrice.id,
          _trial_eligible: requestedTrialEligibility,
        },
      );
      if (checkoutAttemptError) {
        const active = checkoutAttemptError.message?.includes("stripe_active_subscription_exists");
        return {
          error: active
            ? "You already have an active subscription. Resume or manage it in Billing, or wait until it expires before starting another."
            : "Checkout is unavailable right now. Try again.",
        };
      }
      if (
        !checkoutAttempt ||
        typeof checkoutAttempt !== "object" ||
        Array.isArray(checkoutAttempt)
      ) {
        throw new Error("Checkout attempt unavailable");
      }
      const attempt = checkoutAttempt as Record<string, unknown>;
      const idempotencyKey =
        typeof attempt.idempotencyKey === "string" ? attempt.idempotencyKey : "";
      const attemptCustomerId =
        typeof attempt.stripeCustomerId === "string" ? attempt.stripeCustomerId : "";
      const attemptTrialEligible = attempt.trialEligible === true;
      const sessionExpiresAt =
        typeof attempt.sessionExpiresAt === "string"
          ? Math.floor(new Date(attempt.sessionExpiresAt).getTime() / 1000)
          : 0;
      if (
        !idempotencyKey ||
        attemptCustomerId !== customerId ||
        !Number.isSafeInteger(sessionExpiresAt) ||
        (sessionExpiresAt <= Math.floor(Date.now() / 1000) && attempt.outcome === "new")
      ) {
        throw new Error("Checkout attempt invalid");
      }

      const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
        integration_identifier: "kovagpt_checkout_wshrfyef",
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: CHECKOUT_RETURN_URL,
        expires_at: sessionExpiresAt,
        managed_payments: { enabled: true },
        customer: customerId,
        metadata: { userId, kovaCheckoutAttempt: idempotencyKey },
        subscription_data: {
          metadata: { userId },
          ...(attemptTrialEligible && {
            trial_period_days: plan.trialPeriodDays,
          }),
        },
      };
      const session = await resolveDurableCheckoutSession({
        stripe,
        supabase: supabaseAdmin,
        userId,
        environment: BILLING_ENV,
        attempt,
        params: sessionParams,
      });

      if (!session.client_secret) {
        throw new Error("Checkout Session client secret missing");
      }
      return { clientSecret: session.client_secret };
    } catch (error) {
      if (error instanceof StripeCheckoutPendingError) {
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
    if (!durableStripeBillingEnabled())
      return { error: "Billing is awaiting its verified rollout. Contact support." };
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
    const { data: rows, error: subscriptionError } = await context.supabase
      .from("subscriptions")
      .select("stripe_customer_id, price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", context.userId)
      .eq("environment", BILLING_ENV)
      .order("created_at", { ascending: false });
    if (subscriptionError) return { error: "Billing account couldn't be verified. Try again." };
    const sub = selectSubscriptionSummaryRow(rows ?? []);
    if (
      sub &&
      hasVerifiedSubscriptionAccess(sub) &&
      sub.stripe_customer_id !== mapping.stripe_customer_id
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
  effectiveTier: "free" | "plus" | "pro";
  inherited: boolean;
  activeSubscriptionCount: number;
  billingConflict: boolean;
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
    const { data: resolvedSummary, error: summaryError } = await supabaseAdmin.rpc(
      "user_subscription_summary",
      { _user_id: userId },
    );
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

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("stripe_customer_mappings")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .maybeSingle();
    if (mappingError) throw new Error("Billing details couldn't be verified.");

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
      billingPortalAvailable: hasBillingAccount && !!billingPortalConfigurationId(),
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
