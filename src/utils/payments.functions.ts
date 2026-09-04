import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient } from "@/lib/stripe.server";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { CHECKOUT_RETURN_URL } from "@/lib/checkout-return-url.mjs";
import { parseCheckoutRequest } from "@/lib/checkout-request.mjs";
import { BILLING_ENV, resolveBillingPlan, tierForLookupKey } from "@/lib/billing-plans";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CheckoutSessionResult = { clientSecret: string } | { error: string };
// Customer-facing billing is production-only. The environment supplied by a
// browser is never trusted to select Stripe credentials or subscription rows.

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

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({
      email: options.email,
      limit: 1,
    });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (options.userId && customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
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

      // Prevent duplicate current subscriptions for the same user in this env.
      // A scheduled cancellation does not end access or billing immediately, so
      // cancel_at_period_end must never make a second Checkout session eligible.
      const { data: existingRows, error: existingError } = await context.supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", userId)
        .eq("environment", BILLING_ENV)
        .order("created_at", { ascending: false });
      if (existingError) {
        return { error: "Billing status couldn't be verified. Try again." };
      }
      const subscriptions = existingRows ?? [];
      const stillActive = hasStillActiveSubscription(subscriptions);
      if (stillActive) {
        return {
          error:
            "You already have an active subscription. Manage your plan from the billing portal before starting a new one.",
        };
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

      const customerId = await resolveOrCreateCustomer(stripe, {
        email: customerEmail,
        userId,
      });

      // Free-trial eligibility for Plus. A user is eligible only if:
      //   1) they have no subscription row in this env, AND
      //   2) the Stripe Customer we resolved has no subscription history
      //      (so recreating a KovaGPT account with the same email/userId
      //      doesn't grant a second trial).
      let isPlusTrialEligible = plan.trialPeriodDays > 0 && subscriptions.length === 0;
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

// Opens the Stripe Billing Portal so users can update payment methods,
// cancel, or view invoices. The customer id is resolved from the same
// current-subscription row used by the customer-facing billing summary
// (RLS-scoped via `context.supabase`).
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: Record<string, never>) => data)
  .handler(async ({ context }): Promise<PortalResult> => {
    const { supabase, userId } = context;
    const { data: rows, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .order("created_at", { ascending: false });
    if (subscriptionError) {
      return { error: "Billing account couldn't be verified. Try again." };
    }
    const sub = selectSubscriptionSummaryRow(rows ?? []);
    if (!sub?.stripe_customer_id) {
      return { error: "No billing account found. Start a subscription first." };
    }
    try {
      const stripe = createStripeClient(BILLING_ENV);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
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
};

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

// Server-verified subscription summary for the current user. Reads through
// the RLS-scoped supabase client on the middleware context, so users only
// ever see their own row.
export const getSubscriptionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<SubscriptionSummary> => {
    const { supabase, userId } = context;
    const { data: rows, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .eq("environment", BILLING_ENV)
      .order("created_at", { ascending: false });
    if (subscriptionError) {
      throw new Error("Billing details couldn't be verified.");
    }
    const subscriptions = rows ?? [];
    const now = Date.now();
    const row = selectSubscriptionSummaryRow(subscriptions, now);
    const priceId = row?.price_id ?? null;
    const active = !!row && hasVerifiedSubscriptionAccess(row, now);
    const tier = active ? tierForLookupKey(priceId) : "free";
    return {
      tier,
      status: row?.status ?? null,
      priceId,
      currentPeriodEnd: row?.current_period_end ?? null,
      cancelAtPeriodEnd: !!row?.cancel_at_period_end,
      trialing: row?.status === "trialing",
      hasBillingAccount: subscriptions.some((subscription) => !!subscription.stripe_customer_id),
    };
  });
