import type Stripe from "stripe";
export function teamSubscriptionSnapshot(
  subscription: Stripe.Subscription,
  customer: string | null,
): {
  standard: number;
  premium: number;
  interval: "month" | "year";
  items: { id: string; price: string; quantity: number; kind: string }[];
};
export function teamInvitationUpdate(invite: {
  seat: string;
  target_standard: number;
  target_premium: number;
  proration_date: number;
  quote: { items: { id: string; quantity: number; kind: string }[]; priceId: string };
}): Stripe.SubscriptionUpdateParams & {
  items: NonNullable<Stripe.SubscriptionUpdateParams["items"]>;
};
export function teamInvoicePaymentUrl(value: string | null | undefined): string | null;
export function renderTeamInvitation(input: { teamName: string; email: string; seat: string }): {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
};
