import { deliverFundedGift } from "@/lib/gift-delivery.server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loose } from "@/lib/supabase-loose";
import { createStripeClient, type StripeEnv, type VerifiedStripeEvent } from "@/lib/stripe.server";

export const CREDIT_ORDER_KIND = "kova_usage_credits_v1";
export const CREDIT_UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function creditCheckoutEnvironment(): StripeEnv | null {
  const mode = process.env.KOVA_USAGE_CREDIT_CHECKOUT;
  return mode === "sandbox" ? mode : null;
}

export async function projectUsageCreditStripeEvent(event: VerifiedStripeEvent, env: StripeEnv) {
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const object = event.data.object as Stripe.Charge | Stripe.Dispute;
    const intent = object.payment_intent;
    const id = typeof intent === "string" ? intent : intent?.id;
    if (id) {
      const { error } = await loose(supabaseAdmin).rpc("kova_revoke_credit_payment", {
        p_env: env,
        p_intent: id,
        p_refund: "amount_refunded" in object ? object.amount_refunded : 0,
        p_disputed: event.type === "charge.dispute.created",
      });
      // Older deployments can continue to process ordinary subscription refunds.
      if (error && error.code !== "PGRST202") throw new Error("Credit reversal failed.");
    }
    return false;
  }

  if (!event.type.startsWith("checkout.session.")) return false;
  const payload = event.data.object as Stripe.Checkout.Session;
  if (payload.metadata?.kind !== CREDIT_ORDER_KIND) return false;
  if (
    !["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)
  )
    return true;
  const stripe = createStripeClient(env);
  const session = await stripe.checkout.sessions.retrieve(payload.id, {
    expand: ["payment_intent.latest_charge"],
  });
  if (session.payment_status !== "paid") return true;
  const intent = session.payment_intent;
  const charge = intent && typeof intent !== "string" ? intent.latest_charge : null;
  const order = session.metadata?.order;
  if (
    session.metadata?.kind !== CREDIT_ORDER_KIND ||
    !order ||
    !CREDIT_UUID.test(order) ||
    session.mode !== "payment" ||
    session.currency !== "usd" ||
    session.livemode !== (env === "live") ||
    !session.amount_total ||
    !intent ||
    typeof intent === "string" ||
    intent.status !== "succeeded" ||
    !charge ||
    typeof charge === "string" ||
    charge.amount_captured !== session.amount_total
  )
    throw new Error("Credit payment did not match its checkout.");
  const { data, error } = await loose(supabaseAdmin).rpc("kova_fund_credit_order", {
    p_id: order,
    p_env: env,
    p_session: session.id,
    p_intent: intent.id,
    p_amount: session.amount_total,
    p_refund: charge.amount_refunded,
    p_disputed: charge.disputed,
  });
  if (error || data !== true) throw new Error("Credit fulfillment failed.");
  await deliverFundedGift(order, env);
  return true;
}
