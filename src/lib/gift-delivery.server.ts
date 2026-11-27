import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loose } from "@/lib/supabase-loose";
import { createTwilioSmsSender, loadTwilioSmsConfiguration } from "@/lib/twilio-sms.server.mjs";
import type { StripeEnv } from "@/lib/stripe.server";

export type GiftDelivery = {
  channel: "email" | "text" | "self";
  to: string;
  message: string;
  sender: string;
  recipient: string;
};

export function validateGiftDelivery(input: GiftDelivery): GiftDelivery {
  if (
    !input ||
    !["email", "text", "self"].includes(input.channel) ||
    ![input.to, input.message, input.sender, input.recipient].every(
      (value) => typeof value === "string",
    ) ||
    input.message.length > 180 ||
    input.sender.length > 80 ||
    input.recipient.length > 80
  )
    throw new Error("Invalid gift delivery details.");
  const to = input.to.trim();
  if (input.channel === "email" && (to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)))
    throw new Error("Enter a recipient email address.");
  if (input.channel === "text" && !/^\+[1-9]\d{7,14}$/.test(to))
    throw new Error("Enter a phone number with its country code.");
  return {
    channel: input.channel,
    to: input.channel === "self" ? "" : to,
    message: input.message.trim(),
    sender: input.sender.trim(),
    recipient: input.recipient.trim(),
  };
}

export function giftDeliveryAvailability() {
  const enabled = process.env.KOVA_USAGE_GIFT_DELIVERY === "enabled";
  return {
    email: enabled && Boolean(process.env.RESEND_API_KEY && process.env.KOVA_GIFT_FROM_EMAIL),
    text: enabled && loadTwilioSmsConfiguration() !== null,
  };
}

export async function deliverFundedGift(order: string, environment: StripeEnv) {
  if (process.env.KOVA_USAGE_GIFT_DELIVERY !== "enabled") return;
  const db = loose(supabaseAdmin);
  const claim = await db.rpc("kova_take_gift_delivery", { p_id: order, p_env: environment });
  if (claim.error) {
    if (claim.error.code === "PGRST202") return;
    throw new Error("Gift delivery could not be claimed.");
  }
  if (!claim.data) return;
  const delivery = claim.data as GiftDelivery & { code: string };
  let accepted = false;
  try {
    if (delivery.channel === "text") {
      const result = await createTwilioSmsSender(loadTwilioSmsConfiguration())({
        to: delivery.to,
        body: `KovaGPT ${environment === "sandbox" ? "test " : ""}gift code: ${delivery.code}. Redeem at kovagpt.com/settings/gift-cards`,
      });
      accepted = result.outcome === "accepted";
    } else if (delivery.channel === "email") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `kova-gift:${order}`,
        },
        body: JSON.stringify({
          from: process.env.KOVA_GIFT_FROM_EMAIL,
          to: [delivery.to],
          subject:
            environment === "sandbox" ? "Your KovaGPT test gift card" : "Your KovaGPT gift card",
          text: [
            delivery.recipient ? `Hi ${delivery.recipient},` : "",
            `${delivery.sender || "Someone"} sent you a KovaGPT gift card.`,
            delivery.message,
            `Redeem at https://kovagpt.com/settings/gift-cards using code ${delivery.code}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }),
      });
      accepted = response.ok;
      await response.body?.cancel();
    }
  } catch {
    // An ambiguous provider response is never retried automatically. The buyer
    // can still share the original code from Gift history.
  }
  const result = await db.rpc("kova_finish_gift_delivery", {
    p_id: order,
    p_env: environment,
    p_accepted: accepted,
  });
  if (result.error) throw new Error("Gift delivery status could not be recorded.");
}
