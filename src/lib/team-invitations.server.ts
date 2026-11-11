import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "./stripe.server";
import { readTeam, reconcileTeam, teamRpc, type TeamRow } from "./team-billing.server";
import { TEAM_PRICES, validateTeamPrice } from "./team-billing-policy.mjs";
import {
  teamSubscriptionSnapshot,
  teamInvitationUpdate,
  renderTeamInvitation,
} from "./team-invitation-policy.mjs";
import { settleTeamInvitation } from "./team-invitation-workflow.mjs";

export type InvitationQuote = {
  items: { id: string; price: string; quantity: number; kind: string }[];
  priceId: string;
  interval: "month" | "year";
  recurring: number;
  beforeTax: number;
  total: number;
  added: boolean;
};
export type TeamEmailInvitation = {
  id: string;
  team_id: string;
  email: string;
  seat: "standard" | "premium";
  state: "draft" | "billing" | "invited" | "accepted" | "canceled";
  subscription_id: string;
  base_standard: number;
  base_premium: number;
  target_standard: number;
  target_premium: number;
  needs_seat: boolean;
  proration_date: number;
  quote: InvitationQuote;
  email_body: ReturnType<typeof renderTeamInvitation>;
  expires_at: string;
  dispatched_at: string | null;
  invoice_id: string | null;
  mail_sent_at: string | null;
  mail_started_at: string | null;
};
const db = () => loose(supabaseAdmin);
async function inviteRow(id: string) {
  const result = await db().from("team_email_invitations").select("*").eq("id", id).single();
  if (result.error || !result.data) throw new Error("Invitation could not be loaded.");
  return result.data as TeamEmailInvitation;
}
async function updateInvite(id: string, patch: Record<string, unknown>) {
  const result = await db().from("team_email_invitations").update(patch).eq("id", id);
  if (result.error)
    throw new Error("Invitation status could not be saved. Refresh before retrying.");
}
function requireEmailDelivery() {
  if (!process.env.RESEND_API_KEY)
    throw new Error("Invitation email delivery is unavailable. No seat was charged.");
}
export async function quoteTeamEmailInvitation(
  actor: string,
  team: TeamRow,
  email: string,
  seat: "standard" | "premium",
) {
  requireEmailDelivery();
  const body = renderTeamInvitation({ teamName: team.name, email, seat });
  const invite = (await teamRpc("prepare_team_email_invitation", {
    p_actor: actor,
    p_team: team.id,
    p_email: email,
    p_seat: seat,
    p_body: body,
  })) as TeamEmailInvitation;
  if (invite.state !== "draft") return { id: invite.id, state: invite.state, quote: invite.quote };
  if (invite.quote) return { id: invite.id, state: invite.state, quote: invite.quote };
  const stripe = createStripeClient("live");
  const subscription = await stripe.subscriptions.retrieve(invite.subscription_id);
  const snapshot = teamSubscriptionSnapshot(subscription, team.customer_id);
  if (snapshot.standard !== invite.base_standard || snapshot.premium !== invite.base_premium)
    throw new Error("Billing changed. Cancel the pending invitation review and try again.");
  const interval = snapshot.interval as "month" | "year";
  const definition = TEAM_PRICES[`${seat}_${interval}`];
  const prices = await stripe.prices.list({
    lookup_keys: [definition.key],
    active: true,
    limit: 2,
  });
  if (prices.data.length !== 1)
    throw new Error("Seat pricing is unavailable. No payment was started.");
  const priceId = validateTeamPrice(prices.data[0], definition);
  const quote: InvitationQuote = {
    items: snapshot.items,
    priceId,
    interval,
    recurring: invite.needs_seat ? definition.amount : 0,
    beforeTax: 0,
    total: 0,
    added: invite.needs_seat,
  };
  if (invite.needs_seat) {
    const update = teamInvitationUpdate({ ...invite, quote });
    const preview = await stripe.invoices.createPreview({
      customer: team.customer_id!,
      subscription: subscription.id,
      subscription_details: {
        items: update.items,
        proration_behavior: "always_invoice",
        proration_date: invite.proration_date,
      },
    });
    if (
      preview.currency !== "usd" ||
      preview.subtotal_excluding_tax === null ||
      !Number.isInteger(preview.total)
    )
      throw new Error("The seat charge could not be previewed. No payment was started.");
    quote.beforeTax = preview.subtotal_excluding_tax;
    quote.total = preview.total;
  }
  await updateInvite(invite.id, { quote });
  return { id: invite.id, state: invite.state, quote };
}

async function deliverInvitation(invite: TeamEmailInvitation) {
  if (invite.state !== "invited" || invite.mail_sent_at) return;
  requireEmailDelivery();
  const claimed = (await teamRpc("claim_team_invitation_email", {
    p_id: invite.id,
  })) as TeamEmailInvitation | null;
  if (!claimed) return;
  // Immutable server-rendered bytes and key survive provider timeouts/deployments.
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `kova-team-invite:${invite.id}`,
      },
      body: JSON.stringify(claimed.email_body),
    });
  } catch {
    return;
  } // Preserve lease and retry the same key within its safe window.
  let text: string;
  try {
    text = new TextDecoder().decode(
      await readResponseBytesBounded(response, 8192, { timeoutMs: 10000 }),
    );
  } catch {
    return;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (response.ok && typeof value.id === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value.id))
    await updateInvite(invite.id, {
      mail_sent_at: new Date().toISOString(),
      provider_id: value.id,
      mail_lease_until: null,
    });
}

export async function settleEmailInvitation(
  team: TeamRow,
  invite: TeamEmailInvitation,
  dispatch = false,
) {
  const result = await settleTeamInvitation(
    { ...invite, customer_id: team.customer_id },
    {
      stripe: createStripeClient("live"),
      dispatch,
      reconcile: () => reconcileTeam(team),
      finalize: () => teamRpc("finalize_team_email_invitation", { p_id: invite.id }),
      saveInvoice: (id: string) => updateInvite(invite.id, { invoice_id: id }),
    },
  );
  if (result.ready) await deliverInvitation(await inviteRow(invite.id));
  const latest = await inviteRow(invite.id);
  return { ready: result.ready, paymentUrl: result.paymentUrl, emailSent: !!latest.mail_sent_at };
}
export async function sendTeamEmailInvitation(actor: string, id: string) {
  requireEmailDelivery();
  const invite = (await teamRpc("claim_team_email_invitation", {
    p_actor: actor,
    p_id: id,
  })) as TeamEmailInvitation;
  const team = await readTeam(invite.team_id);
  if (team.owner_id !== actor) throw new Error("Only the team owner can send invitations.");
  return settleEmailInvitation(team, invite, true);
}
export async function reconcileTeamEmailInvitations(team: TeamRow) {
  const result = await db()
    .from("team_email_invitations")
    .select("*")
    .eq("team_id", team.id)
    .in("state", ["billing", "invited"])
    .limit(150);
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) return;
    throw new Error("Invitations could not be refreshed.");
  }
  for (const row of result.data ?? [])
    await settleEmailInvitation(team, row as TeamEmailInvitation);
}
export async function ownedEmailInvitations(teamId: string) {
  const result = await db()
    .from("team_email_invitations")
    .select("id,email,seat,state,mail_sent_at,expires_at,quote")
    .eq("team_id", teamId)
    .in("state", ["draft", "billing", "invited"])
    .order("created_at", { ascending: false });
  if (result.error) throw new Error("Invitations could not be loaded.");
  return result.data as {
    id: string;
    email: string;
    seat: string;
    state: string;
    mail_sent_at: string | null;
    expires_at: string;
    quote: InvitationQuote | null;
  }[];
}

/** One server-selected retry when the existing signed worker has spare capacity. */
export async function retryTeamInvitationEmail() {
  const now = new Date().toISOString();
  const result = await db()
    .from("team_email_invitations")
    .select("*")
    .eq("state", "invited")
    .is("mail_sent_at", null)
    .gt("expires_at", now)
    .or(`mail_lease_until.is.null,mail_lease_until.lt.${now}`)
    .or(
      `mail_started_at.is.null,mail_started_at.gt.${new Date(Date.now() - 23 * 3600000).toISOString()}`,
    )
    .order("created_at", { ascending: true })
    .limit(1);
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) return 0;
    throw new Error("Invitation email queue could not be read.");
  }
  if (!result.data?.length) return 0;
  const invite = result.data[0] as TeamEmailInvitation;
  await settleEmailInvitation(await readTeam(invite.team_id), invite);
  return 1;
}
