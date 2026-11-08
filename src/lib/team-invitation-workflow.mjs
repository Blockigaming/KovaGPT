import { teamInvitationUpdate, teamInvoicePaymentUrl } from "./team-invitation-policy.mjs";

/** Never called by GET/webhooks with dispatch=true. Retrying uses the same persisted Stripe key. */
export async function settleTeamInvitation(
  invite,
  { stripe, reconcile, finalize, saveInvoice, dispatch = false, now = Date.now },
) {
  if (invite.state !== "billing")
    return { ready: ["invited", "accepted"].includes(invite.state), paymentUrl: null };
  if (!invite.needs_seat) {
    await reconcile();
    return { ready: await finalize(), paymentUrl: null };
  }
  let subscription = await stripe.subscriptions.retrieve(invite.subscription_id, {
    expand: ["latest_invoice"],
  });
  if (
    !subscription.livemode ||
    subscription.id !== invite.subscription_id ||
    subscription.customer !== invite.customer_id
  )
    throw new Error("Team billing identity changed. No invitation was sent.");
  const targetPresent = () => {
    const counts = { standard: 0, premium: 0 };
    for (const item of subscription.items.data) {
      if (
        item.price.lookup_key ===
        `kova_team_standard_${invite.quote.interval === "year" ? "annual" : "monthly"}`
      )
        counts.standard += item.quantity;
      else if (
        item.price.lookup_key ===
        `kova_team_premium_${invite.quote.interval === "year" ? "annual" : "monthly"}`
      )
        counts.premium += item.quantity;
      else return false;
    }
    return (
      !subscription.items.has_more &&
      counts.standard >= invite.target_standard &&
      counts.premium >= invite.target_premium
    );
  };
  if (dispatch && !targetPresent() && !subscription.pending_update) {
    if (!["active", "trialing"].includes(subscription.status))
      throw new Error("Resolve existing subscription payments before adding a seat.");
    if (now() - Date.parse(invite.dispatched_at) > 23 * 3600_000)
      throw new Error(
        "Billing needs reconciliation. No additional charge was attempted. Contact support.",
      );
    // The current subscription must still be the exact one reviewed by the owner.
    const baseline = subscription.items.data.map((i) => ({
      id: i.id,
      price: i.price.id,
      quantity: i.quantity,
      kind: i.price.lookup_key?.includes("standard") ? "standard" : "premium",
    }));
    if (JSON.stringify(baseline) !== JSON.stringify(invite.quote.items))
      throw new Error("Team billing changed after review. No additional charge was attempted.");
    subscription = await stripe.subscriptions.update(
      invite.subscription_id,
      teamInvitationUpdate(invite),
      { idempotencyKey: `kova-team-invite:${invite.id}` },
    );
  }
  let invoice = subscription.latest_invoice;
  if (typeof invoice === "string") invoice = await stripe.invoices.retrieve(invoice);
  if (invite.invoice_id && invoice?.id !== invite.invoice_id)
    throw new Error("The seat payment needs reconciliation. No invitation was sent.");
  if (invoice?.id) await saveInvoice(invoice.id);
  if (
    subscription.pending_update ||
    !targetPresent() ||
    !["active", "trialing"].includes(subscription.status) ||
    invoice?.status !== "paid"
  )
    return { ready: false, paymentUrl: teamInvoicePaymentUrl(invoice?.hosted_invoice_url) };
  await reconcile();
  return { ready: await finalize(), paymentUrl: null };
}
