import {
  giftDeliveryAvailability,
  validateGiftDelivery,
  type GiftDelivery,
} from "@/lib/gift-delivery.server";
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
  environment: "live" | "sandbox";
  fundedCents: number;
  spentMicros: number;
  spending: { id: string; model: string; date: string; micros: number; pending: boolean }[];
  delivery: { email: boolean; text: boolean };
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
    const environment = await creditCheckoutEnvironment();
    if (!environment) return null;
    const result = await loose(supabaseAdmin)
      .rpc("kova_credit_wallet", { p_user: context.userId, p_env: environment })
      .abortSignal(AbortSignal.timeout(10_000));
    if (result.error || !result.data) throw new Error("Credit wallet unavailable.");
    const spending = await loose(supabaseAdmin)
      .rpc("kova_credit_spending_history", {
        p_user: context.userId,
        p_env: environment,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (spending.error || !spending.data) throw new Error("Credit spending unavailable.");
    return {
      ...result.data,
      environment,
      spentMicros: spending.data.spentMicros,
      spending: spending.data.entries,
      delivery: giftDeliveryAvailability(),
    } as UsageWallet;
  });

export const createUsageCreditCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: {
      ownerId: string;
      orderId: string;
      cents: number;
      gift: boolean;
      design?: string;
      delivery?: GiftDelivery;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    const environment = await creditCheckoutEnvironment();
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
    const delivery = data.gift && data.delivery ? validateGiftDelivery(data.delivery) : undefined;
    const availability = giftDeliveryAvailability();
    if (delivery && delivery.channel !== "self" && !availability[delivery.channel])
      throw new Error("This delivery method is unavailable.");
    const prepared = await loose(supabaseAdmin).rpc("kova_prepare_credit_order", {
      p_id: data.orderId,
      p_buyer: context.userId,
      p_env: environment,
      p_amount: data.cents,
      p_gift: data.gift,
    });
    if (prepared.error || prepared.data !== true) throw new Error("Could not prepare checkout.");
    if (delivery && delivery.channel !== "self") {
      const saved = await loose(supabaseAdmin).rpc("kova_set_gift_delivery", {
        p_id: data.orderId,
        p_buyer: context.userId,
        p_env: environment,
        p_delivery: delivery,
      });
      if (saved.error || saved.data !== true) throw new Error("Could not save gift delivery.");
    }
    const design =
      data.gift && ["Midnight", "Evergreen", "Ember"].includes(data.design ?? "")
        ? data.design
        : undefined;
    const section = data.gift ? "gift-cards" : "usage";
    const returnUrl = `https://kovagpt.com/settings/${section}`;
    const session = await createStripeClient(environment).checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        metadata: { kind: CREDIT_ORDER_KIND, order: data.orderId, ...(design ? { design } : {}) },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: data.cents,
              product_data: {
                name: data.gift
                  ? `KovaGPT usage credit gift${design ? ` · ${design}` : ""}`
                  : "KovaGPT usage credits",
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
    const environment = await creditCheckoutEnvironment();
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
