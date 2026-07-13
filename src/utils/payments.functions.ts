import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CheckoutSessionResult = { clientSecret: string } | { error: string };

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
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
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
  .inputValidator(
    (data: {
      priceId: string;
      quantity?: number;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const userId = context.userId;
      const customerEmail =
        typeof context.claims.email === "string" ? context.claims.email : undefined;
      const stripe = createStripeClient(data.environment);

      // Prevent duplicate active subscriptions for the same user in this env.
      const { data: existing } = await context.supabase
        .from("subscriptions")
        .select("status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
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

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];
      const isRecurring = stripePrice.type === "recurring";

      const customerId = await resolveOrCreateCustomer(stripe, {
        email: customerEmail,
        userId,
      });

      // Free-trial eligibility for Plus. A user is eligible only if:
      //   1) they have no subscription row in this env, AND
      //   2) the Stripe Customer we resolved has no subscription history
      //      (so recreating a KovaGPT account with the same email/userId
      //      doesn't grant a second trial).
      let isPlusTrialEligible = isRecurring && data.priceId === "plus_monthly" && !existing;
      if (isPlusTrialEligible) {
        const prior = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 1,
        });
        if (prior.data.length > 0) isPlusTrialEligible = false;
      }


      const sessionParams: Record<string, unknown> = {
        line_items: [{ price: stripePrice.id, quantity: data.quantity || 1 }],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        managed_payments: { enabled: true },
        customer: customerId,
        metadata: { userId },
        ...(isRecurring && {
          subscription_data: {
            metadata: { userId },
            ...(isPlusTrialEligible && { trial_period_days: 30 }),
          },
        }),
      };
      const session = await stripe.checkout.sessions.create(
        sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0],
      );

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

type PortalResult = { url: string } | { error: string };

// Opens the Stripe Billing Portal so users can update payment methods,
// cancel, or view invoices. The customer id is resolved from the most
// recent subscription row for this user + env (RLS-scoped via `context.supabase`).
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      return { error: "No billing account found. Start a subscription first." };
    }
    try {
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
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

// Server-verified subscription summary for the current user. Reads through
// the RLS-scoped supabase client on the middleware context, so users only
// ever see their own row.
export const getSubscriptionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<SubscriptionSummary> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, price_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const priceId = row?.price_id ?? null;
    const id = (priceId ?? "").toLowerCase();
    const now = Date.now();
    const end = row?.current_period_end ? new Date(row.current_period_end).getTime() : 0;
    const active =
      !!row &&
      ((["active", "trialing", "past_due"].includes(row.status) &&
        (!row.current_period_end || end > now)) ||
        (row.status === "canceled" && end > now));
    let tier: "free" | "plus" | "pro" = "free";
    if (active) {
      if (id.includes("pro")) tier = "pro";
      else if (id.includes("plus")) tier = "plus";
    }
    return {
      tier,
      status: row?.status ?? null,
      priceId,
      currentPeriodEnd: row?.current_period_end ?? null,
      cancelAtPeriodEnd: !!row?.cancel_at_period_end,
      trialing: row?.status === "trialing",
      hasBillingAccount: !!row?.stripe_customer_id,
    };
  });

