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

      // First month of Plus is free — give a 30-day trial to any user who
      // has never had a subscription in this environment before.
      const isPlusTrialEligible =
        isRecurring &&
        data.priceId === "plus_monthly" &&
        !existing;

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
