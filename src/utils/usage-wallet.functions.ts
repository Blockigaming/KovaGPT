import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loose } from "@/lib/supabase-loose";
import { createStripeClient } from "@/lib/stripe.server";
import {
  CREDIT_ORDER_KIND,
  CREDIT_UUID,
  creditCheckoutEnvironment,
} from "@/lib/usage-credit-checkout.server";

export type UsageWallet = {
  fundedCents: number;
  orders: {
    id: string;
    gift: boolean;
    giftCode: string | null;
    amountCents: number;
    refundedCents: number;
    disputed: boolean;
    date: string;
    shareable: boolean;
  }[];
};

export const getMyUsageWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { ownerId: string }) => data)
  .handler(async ({ context, data }): Promise<UsageWallet | null> => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed.");
    const environment = creditCheckoutEnvironment();
    if (!environment) return null;
    const result = await loose(supabaseAdmin)
      .rpc("kova_credit_wallet", { p_user: context.userId, p_env: environment })
      .abortSignal(AbortSignal.timeout(10_000));
    if (result.error || !result.data) throw new Error("Credit wallet unavailable.");
    return result.data as UsageWallet;
  });

export const createUsageCreditCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { ownerId: string; orderId: string; cents: number; gift: boolean }) => data)
  .handler(async ({ context, data }) => {
    const environment = creditCheckoutEnvironment();
    if (
      !environment ||
      data.ownerId !== context.userId ||
      !CREDIT_UUID.test(data.orderId) ||
      !Number.isInteger(data.cents) ||
      data.cents < 500 ||
      data.cents > 50000 ||
      typeof data.gift !== "boolean"
    )
      throw new Error("Checkout is unavailable.");
    const prepared = await loose(supabaseAdmin).rpc("kova_prepare_credit_order", {
      p_id: data.orderId,
      p_buyer: context.userId,
      p_env: environment,
      p_amount: data.cents,
      p_gift: data.gift,
    });
    if (prepared.error || prepared.data !== true) throw new Error("Could not prepare checkout.");
    const section = data.gift ? "gift-cards" : "usage";
    const returnUrl = `https://kovagpt.com/settings/${section}`;
    const session = await createStripeClient(environment).checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        metadata: { kind: CREDIT_ORDER_KIND, order: data.orderId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: data.cents,
              product_data: {
                name: data.gift ? "KovaGPT usage credit gift" : "KovaGPT usage credits",
              },
            },
          },
        ],
        success_url: returnUrl,
        cancel_url: returnUrl,
      },
      { idempotencyKey: `kova-credit:${context.userId}:${data.orderId}` },
    );
    if (!session.url || !session.url.startsWith("https://checkout.stripe.com/"))
      throw new Error("Checkout URL unavailable.");
    return session.url;
  });

export const redeemUsageCreditGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { ownerId: string; code: string }) => data)
  .handler(async ({ context, data }) => {
    const environment = creditCheckoutEnvironment();
    if (!environment || data.ownerId !== context.userId || !CREDIT_UUID.test(data.code))
      throw new Error("Gift code unavailable.");
    const result = await loose(supabaseAdmin).rpc("kova_claim_credit_gift", {
      p_id: data.code,
      p_user: context.userId,
      p_env: environment,
    });
    if (result.error || result.data !== true) throw new Error("Gift code unavailable.");
    return true;
  });
