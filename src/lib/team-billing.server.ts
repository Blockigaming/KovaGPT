import type Stripe from "stripe";
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "./stripe.server";
import { TEAM_PRICES, validateTeamPrice } from "./team-billing-policy.mjs";

export async function teamRpc(name: string, args: Record<string, unknown>) {
  const result = await loose(supabaseAdmin).rpc(name, args).abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw new Error("Team changes could not be confirmed. Refresh and try again.");
  return result.data;
}
export async function readTeam(id: string) {
  const result = await loose(supabaseAdmin)
    .from("team_workspaces")
    .select("*")
    .eq("id", id)
    .single();
  if (result.error || !result.data) throw new Error("Team could not be loaded.");
  return result.data as TeamRow;
}
export type TeamRow = {
  id: string;
  owner_id: string;
  name: string;
  customer_id: string | null;
  subscription_id: string | null;
  billing_hold?: boolean;
  status: string;
  standard_seats: number;
  premium_seats: number;
  paid_until: string | null;
  checkout_generation: string;
  checkout_config: { standard: number; premium: number; interval: "month" | "year" } | null;
  checkout_session: string | null;
  checkout_started_at: string;
};
export async function reconcileTeam(
  team: TeamRow,
  stripe = createStripeClient("live"),
  observedAt = new Date().toISOString(),
) {
  if (!team.customer_id) return;
  const subscriptions = await stripe.subscriptions.list({
    customer: team.customer_id,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more) throw new Error("Team billing requires reconciliation.");
  const matches = subscriptions.data.filter((sub) =>
    sub.items.data.some((item) =>
      Object.values(TEAM_PRICES).some((p) => item.price.lookup_key === p.key),
    ),
  );
  const active = matches.filter((sub) =>
    ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"].includes(sub.status),
  );
  if (active.length > 1) throw new Error("Multiple team subscriptions need reconciliation.");
  const subscription = active[0] ?? matches.sort((a, b) => b.created - a.created)[0];
  if (!subscription) return;
  if (
    subscription.customer !== team.customer_id ||
    !subscription.livemode ||
    subscription.items.has_more
  )
    throw new Error("Team subscription identity mismatch.");
  let standard = 0,
    premium = 0;
  const periods: number[] = [];
  const seen = new Set<string>();
  for (const item of subscription.items.data) {
    const definition = Object.entries(TEAM_PRICES).find(
      ([, value]) => value.key === item.price.lookup_key,
    );
    if (!definition || seen.has(definition[0].split("_")[0]))
      throw new Error("Unexpected Team subscription item.");
    validateTeamPrice(item.price, definition[1]);
    if (!Number.isInteger(item.quantity) || item.quantity! < 1 || item.quantity! > 150)
      throw new Error("Invalid Team seat count.");
    const kind = definition[0].split("_")[0];
    seen.add(kind);
    if (kind === "standard") standard += item.quantity!;
    else premium += item.quantity!;
    periods.push(item.current_period_end);
  }
  if (standard + premium > 150) throw new Error("Invalid Team seat count.");
  await teamRpc("reconcile_team_subscription", {
    p_team: team.id,
    p_customer: team.customer_id,
    p_subscription: subscription.id,
    p_status: subscription.status,
    p_standard: standard,
    p_premium: premium,
    p_until: new Date(Math.min(...periods) * 1000).toISOString(),
    p_observed: observedAt,
  });
}
/** Signature verification precedes this. Resolve tenancy through the persisted Customer ID. */
export async function projectTeamStripeEvent(event: {
  livemode: boolean;
  type: string;
  data: { object: unknown };
}) {
  const value = event.data.object as {
    customer?: string | { id: string };
    charge?: string | { id: string };
  };
  const risk = [
    "charge.dispute.created",
    "charge.refunded",
    "radar.early_fraud_warning.created",
  ].includes(event.type);
  let customer = typeof value.customer === "string" ? value.customer : value.customer?.id;
  if (event.livemode && risk && !customer && value.charge) {
    const chargeId = typeof value.charge === "string" ? value.charge : value.charge.id;
    const charge = await createStripeClient("live").charges.retrieve(chargeId);
    customer = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  }
  if (
    !event.livemode ||
    !customer ||
    !/^(checkout\.session\.|customer\.subscription\.|invoice\.|charge\.|radar\.)/.test(event.type)
  )
    return false;
  const result = await loose(supabaseAdmin)
    .from("team_workspaces")
    .select("*")
    .eq("customer_id", customer)
    .maybeSingle();
  // Before rollout the additive migration may be absent; personal webhook processing remains intact.
  if (result.error?.code === "42P01" || result.error?.code === "PGRST205") return false;
  if (result.error) throw new Error("Team billing identity could not be read.");
  if (!result.data) return false;
  if (risk) {
    const hold = await loose(supabaseAdmin)
      .from("team_workspaces")
      .update({ billing_hold: true })
      .eq("id", result.data.id)
      .eq("customer_id", customer);
    if (hold.error) throw new Error("Team billing review could not be saved.");
  }
  await reconcileTeam(result.data as TeamRow);
  const { reconcileTeamEmailInvitations } = await import("./team-invitations.server");
  await reconcileTeamEmailInvitations(await readTeam(result.data.id));
  return true;
}
