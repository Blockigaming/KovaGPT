import { TEAM_PRICES, validateTeamPrice } from "./team-billing-policy.mjs";

export function teamSubscriptionSnapshot(subscription, customer) {
  if (
    !subscription ||
    subscription.customer !== customer ||
    !subscription.livemode ||
    subscription.items?.has_more ||
    !["active", "trialing"].includes(subscription.status) ||
    subscription.pending_update ||
    subscription.cancel_at_period_end ||
    subscription.schedule
  )
    throw new Error("Resolve pending billing changes before inviting members.");
  const snapshot = { standard: 0, premium: 0, interval: null, items: [] };
  for (const item of subscription.items.data) {
    const entry = Object.entries(TEAM_PRICES).find(([, p]) => p.key === item.price.lookup_key);
    if (!entry) throw new Error("Team subscription pricing could not be verified.");
    const kind = entry[0].split("_")[0];
    validateTeamPrice(item.price, entry[1]);
    if (
      snapshot[kind] ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 150 ||
      (snapshot.interval && snapshot.interval !== entry[1].interval)
    )
      throw new Error("Team subscription quantities could not be verified.");
    snapshot.interval = entry[1].interval;
    snapshot[kind] = item.quantity;
    snapshot.items.push({ id: item.id, price: item.price.id, quantity: item.quantity, kind });
  }
  if (!snapshot.interval || snapshot.standard + snapshot.premium > 150)
    throw new Error("Team subscription quantities could not be verified.");
  return snapshot;
}

export function teamInvitationUpdate(invite) {
  const items = invite.quote.items.map(({ id, quantity }) => ({ id, quantity }));
  const index = invite.quote.items.findIndex((i) => i.kind === invite.seat);
  const target = invite.seat === "standard" ? invite.target_standard : invite.target_premium;
  if (index >= 0) items[index].quantity = target;
  else items.push({ price: invite.quote.priceId, quantity: target });
  return {
    items,
    proration_behavior: "always_invoice",
    proration_date: invite.proration_date,
    payment_behavior: "pending_if_incomplete",
    expand: ["latest_invoice"],
  };
}

export function teamInvoicePaymentUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "invoice.stripe.com" ||
    url.username ||
    url.password
  )
    throw new Error("Secure invoice payment is unavailable.");
  return url.href;
}

const escape = (v) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export function renderTeamInvitation({ teamName, email, seat }) {
  if (
    typeof teamName !== "string" ||
    !teamName.trim() ||
    teamName.length > 100 ||
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ||
    !["standard", "premium"].includes(seat)
  )
    throw new Error("Invalid team invitation.");
  const name = escape(teamName);
  return {
    from: "KovaGPT <noreply@kovagpt.com>",
    to: [email],
    subject: "You're invited to a KovaGPT team",
    text: `You're invited to ${teamName} on KovaGPT with a ${seat} seat.\nSign in or create an account using ${email}, verify your email, and accept at https://kovagpt.com/team\nThe team owner pays for your seat. You will not be charged for accepting.\nIf you weren't expecting this invitation, you can ignore this email.`,
    html: `<html><body style="margin:0;background:#f4f4f2;font-family:Arial,sans-serif;color:#202020;padding:32px 12px"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e5e5e3;border-radius:24px;padding:32px"><p style="font-size:18px;font-weight:600">KovaGPT</p><h1 style="font-size:28px;letter-spacing:-1px">Your team is waiting</h1><p style="line-height:1.7">You've been invited to <strong>${name}</strong> with a ${seat} seat.</p><p style="line-height:1.7">Sign in or create an account using <strong>${escape(email)}</strong>, then verify your email to accept.</p><p style="margin:32px 0"><a href="https://kovagpt.com/team" style="display:inline-block;background:#202020;color:#fff;text-decoration:none;border-radius:999px;padding:14px 24px">View invitation</a></p><p style="font-size:14px;line-height:1.7;color:#666">Your team owner pays for the seat. Accepting won't charge you. If you weren't expecting this invitation, you can ignore it.</p></div></body></html>`,
  };
}
