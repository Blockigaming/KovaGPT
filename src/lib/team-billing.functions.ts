import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireVerifiedUser } from "./api-auth.server";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "./stripe.server";
import { billingReturnUrls } from "@/lib/checkout-return-url.mjs";
import { parseAllowedBillingPortalUrl } from "./billing-portal-url.mjs";
import {
  TEAM_PRICES,
  validateTeamSelection,
  validateTeamPrice,
  teamCheckoutUrl,
} from "./team-billing-policy.mjs";
import { readTeam, reconcileTeam, teamRpc, type TeamRow } from "./team-billing.server";

const verified = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const auth = await requireVerifiedUser(getRequest());
  if (auth instanceof Response) throw auth;
  const rate = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action: "team_billing",
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) throw new Error("Please wait a moment before trying again.");
  return next({ context: { userId: auth.userId } });
});
async function owned(teamId: string, owner: string) {
  const team = await readTeam(teamId);
  if (team.owner_id !== owner) throw new Error("Only the team owner can manage billing.");
  return team;
}
export type TeamWorkspaceView = {
  teams: {
    id: string;
    name: string;
    owner: boolean;
    status: string;
    standard: number;
    premium: number;
    paidUntil: string | null;
    members: { user_id: string; email?: string; seat: string; state: string }[];
  }[];
  invitations: { id: string; name: string; seat: string }[];
};
export const getTeamWorkspace = createServerFn({ method: "GET" })
  .middleware([verified])
  .handler(async ({ context }): Promise<TeamWorkspaceView> => {
    const owner = context.userId;
    const members = await loose(supabaseAdmin)
      .from("team_members")
      .select("team_id, seat, state")
      .eq("user_id", owner)
      .neq("state", "removed");
    const own = await loose(supabaseAdmin)
      .from("team_workspaces")
      .select("id")
      .eq("owner_id", owner);
    if (members.error || own.error) throw new Error("Team workspace could not be loaded.");
    const ids = [
      ...new Set([
        ...(own.data ?? []).map((t: { id: string }) => t.id),
        ...(members.data ?? []).map((t: { team_id: string }) => t.team_id),
      ]),
    ] as string[];
    const view: TeamWorkspaceView = { teams: [], invitations: [] };
    for (const id of ids) {
      let team = await readTeam(id);
      await reconcileTeam(team);
      team = await readTeam(id);
      const membership = members.data?.find((m: { team_id: string }) => m.team_id === id);
      if (membership?.state === "invited" && team.owner_id !== owner) {
        view.invitations.push({ id, name: team.name, seat: membership.seat });
        continue;
      }
      const rows = await loose(supabaseAdmin)
        .from("team_members")
        .select("user_id,email,seat,state")
        .eq("team_id", id)
        .neq("state", "removed");
      if (rows.error) throw new Error("Team members could not be loaded.");
      view.teams.push({
        id,
        name: team.name,
        owner: team.owner_id === owner,
        status: team.billing_hold ? "billing_review" : team.status,
        standard: team.standard_seats,
        premium: team.premium_seats,
        paidUntil: team.paid_until,
        members: team.owner_id === owner ? (rows.data ?? []) : [],
      });
    }
    return view;
  });
export const createTeamCheckout = createServerFn({ method: "POST" })
  .middleware([verified])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        standard: z.number().int(),
        premium: z.number().int(),
        interval: z.enum(["month", "year"]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const selection = validateTeamSelection(data);
    const stripe = createStripeClient("live");
    const returns = billingReturnUrls(process.env.KOVA_BILLING_RETURN_ORIGIN);
    const lineItems: { price: string; quantity: number }[] = [];
    for (const kind of ["standard", "premium"] as const) {
      if (!selection[kind]) continue;
      const definition = TEAM_PRICES[`${kind}_${selection.interval}`];
      const prices = await stripe.prices.list({
        lookup_keys: [definition.key],
        active: true,
        limit: 2,
      });
      if (prices.data.length !== 1 || prices.has_more)
        throw new Error("Team prices need configuration. No payment was started.");
      lineItems.push({
        price: validateTeamPrice(prices.data[0], definition),
        quantity: selection[kind],
      });
    }
    const init = await loose(supabaseAdmin)
      .from("team_workspaces")
      .upsert(
        { owner_id: context.userId, name: data.name },
        { onConflict: "owner_id", ignoreDuplicates: true },
      );
    if (init.error) throw new Error("Team workspace could not be prepared.");
    const result = await loose(supabaseAdmin)
      .from("team_workspaces")
      .select("*")
      .eq("owner_id", context.userId)
      .single();
    if (result.error) throw new Error("Team workspace could not be loaded.");
    let team = result.data as TeamRow;
    if (!team.customer_id) {
      // Recovery by immutable team ID after Stripe's idempotency retention window.
      const found = await stripe.customers.search({
        query: `metadata['kovaTeam']:'${team.id}'`,
        limit: 2,
      });
      if (found.has_more || found.data.length > 1)
        throw new Error("Team customer needs reconciliation.");
      if (!found.data.length && Date.now() - Date.parse(team.checkout_started_at) >= 23 * 3600000)
        throw new Error(
          "Team customer creation needs reconciliation. No duplicate customer was created.",
        );
      const customer =
        found.data[0] ??
        (await stripe.customers.create(
          { name: team.name, metadata: { kovaTeam: team.id } },
          { idempotencyKey: `kova-team-customer:${team.id}` },
        ));
      const bind = await loose(supabaseAdmin)
        .from("team_workspaces")
        .update({ customer_id: customer.id })
        .eq("id", team.id)
        .is("customer_id", null);
      if (bind.error) throw new Error("Team customer could not be confirmed.");
      team = await readTeam(team.id);
    }
    await reconcileTeam(team, stripe);
    team = await readTeam(team.id);
    if (["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(team.status))
      throw new Error("This team already has a subscription. Manage its seats in billing.");
    // Immutable selection per durable checkout generation. Retrying cannot create a second subscription.
    const selectionKey = JSON.stringify(selection);
    if (
      team.checkout_config &&
      JSON.stringify(team.checkout_config, ["standard", "premium", "interval"]) !== selectionKey
    )
      throw new Error("A different Team checkout is pending. Cancel it before changing seats.");
    const claim = await loose(supabaseAdmin)
      .from("team_workspaces")
      .update({ checkout_config: selection })
      .eq("id", team.id)
      .eq("checkout_generation", team.checkout_generation)
      .is("checkout_config", null);
    if (claim.error) throw new Error("Team checkout could not be prepared.");
    team = await readTeam(team.id);
    if (JSON.stringify(team.checkout_config, ["standard", "premium", "interval"]) !== selectionKey)
      throw new Error("Team checkout selection changed. Refresh first.");
    let session;
    if (team.checkout_session)
      session = await stripe.checkout.sessions.retrieve(team.checkout_session);
    else {
      const sessions = await stripe.checkout.sessions.list({
        customer: team.customer_id!,
        limit: 100,
      });
      if (sessions.has_more) throw new Error("Team checkout needs reconciliation.");
      session = sessions.data.find((s) => s.client_reference_id === team.checkout_generation);
      if (!session) {
        if (Date.now() - Date.parse(team.checkout_started_at) >= 23 * 3600000)
          throw new Error("Cancel the expired Team checkout before trying again.");
        session = await stripe.checkout.sessions.create(
          {
            integration_identifier: "kovagpt_team_checkout_xcrqvpza",
            mode: "subscription",
            ui_mode: "hosted_page",
            customer: team.customer_id!,
            client_reference_id: team.checkout_generation,
            line_items: lineItems,
            success_url: `${new URL(returns.checkout).origin}/team`,
            cancel_url: `${new URL(returns.checkout).origin}/team`,
          },
          { idempotencyKey: `kova-team-checkout:${team.checkout_generation}` },
        );
      }
      const bound = await loose(supabaseAdmin)
        .from("team_workspaces")
        .update({ checkout_session: session.id })
        .eq("id", team.id)
        .eq("checkout_generation", team.checkout_generation);
      if (bound.error) throw new Error("Team checkout could not be confirmed.");
    }
    if (
      session.customer !== team.customer_id ||
      session.client_reference_id !== team.checkout_generation ||
      session.status !== "open" ||
      !session.url
    )
      throw new Error("Team checkout is no longer open. Refresh the workspace.");
    return { url: teamCheckoutUrl(session.url) };
  });
export const cancelTeamCheckout = createServerFn({ method: "POST" })
  .middleware([verified])
  .validator((value: unknown) => z.object({ teamId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const team = await owned(data.teamId, context.userId);
    const stripe = createStripeClient("live");
    if (!team.customer_id) throw new Error("No pending checkout was found.");
    const sessions = await stripe.checkout.sessions.list({
      customer: team.customer_id,
      limit: 100,
    });
    if (sessions.has_more) throw new Error("Checkout needs reconciliation.");
    const session = sessions.data.find((s) => s.client_reference_id === team.checkout_generation);
    if (session) {
      if (
        session.status === "complete" ||
        session.subscription ||
        session.payment_status !== "unpaid"
      )
        throw new Error("Payment has started. Refresh billing before changing seats.");
      if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
      if ((await stripe.checkout.sessions.retrieve(session.id)).status !== "expired")
        throw new Error("Checkout cancellation could not be confirmed.");
    } else if (Date.now() - Date.parse(team.checkout_started_at) < 24 * 3600000)
      throw new Error("An unconfirmed checkout must reconcile before cancellation. Retry later.");
    const reset = await loose(supabaseAdmin)
      .from("team_workspaces")
      .update({
        checkout_generation: crypto.randomUUID(),
        checkout_config: null,
        checkout_session: null,
        checkout_started_at: new Date().toISOString(),
      })
      .eq("id", team.id)
      .eq("checkout_generation", team.checkout_generation);
    if (reset.error) throw new Error("Checkout cancellation could not be saved.");
    return { ok: true };
  });
export const mutateTeamMember = createServerFn({ method: "POST" })
  .middleware([verified])
  .validator((value: unknown) =>
    z
      .object({
        teamId: z.string().uuid(),
        action: z.enum(["invite", "accept", "remove"]),
        email: z.string().email().max(254).optional(),
        userId: z.string().uuid().optional(),
        seat: z.enum(["standard", "premium"]).default("standard"),
      })
      .strict()
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const team = await readTeam(data.teamId);
    if (data.action !== "accept" && team.owner_id !== context.userId)
      throw new Error("Only the owner can manage invitations.");
    await reconcileTeam(team);
    await teamRpc("mutate_team_member", {
      p_actor: context.userId,
      p_team: data.teamId,
      p_action: data.action,
      p_email: data.email ?? null,
      p_user: data.userId ?? null,
      p_seat: data.seat,
    });
    return { ok: true };
  });
export const createTeamPortal = createServerFn({ method: "POST" })
  .middleware([verified])
  .validator((value: unknown) =>
    z
      .object({
        teamId: z.string().uuid(),
        standard: z.number().int().min(0).max(150).optional(),
        premium: z.number().int().min(0).max(150).optional(),
      })
      .strict()
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const team = await owned(data.teamId, context.userId);
    if (!team.customer_id) throw new Error("Complete checkout first.");
    const stripe = createStripeClient("live");
    let flow;
    if (data.standard !== undefined || data.premium !== undefined) {
      const standard = data.standard ?? team.standard_seats,
        premium = data.premium ?? team.premium_seats;
      validateTeamSelection({ standard, premium, interval: "month" });
      if (team.billing_hold)
        throw new Error("Team billing is under review. Contact support before changing seats.");
      if (!team.subscription_id) throw new Error("No active Team subscription was found.");
      const subscription = await stripe.subscriptions.retrieve(team.subscription_id);
      if (subscription.customer !== team.customer_id || !subscription.livemode)
        throw new Error("Team billing identity changed.");
      const items = subscription.items.data.map((item) => ({
        id: item.id,
        quantity: item.price.lookup_key?.includes("standard") ? standard : premium,
      }));
      // New seat types use a new paid line item and need the general Portal plan selector.
      if (
        (standard > 0 &&
          !subscription.items.data.some((i) => i.price.lookup_key?.includes("standard"))) ||
        (premium > 0 &&
          !subscription.items.data.some((i) => i.price.lookup_key?.includes("premium")))
      )
        throw new Error("Use Manage billing to change seat types.");
      flow = {
        type: "subscription_update_confirm" as const,
        subscription_update_confirm: { subscription: subscription.id, items },
      };
    }
    const url = await stripe.billingPortal.sessions.create({
      customer: team.customer_id,
      return_url: `${new URL(billingReturnUrls(process.env.KOVA_BILLING_RETURN_ORIGIN).checkout).origin}/team`,
      ...(flow ? { flow_data: flow } : {}),
    });
    const allowed = parseAllowedBillingPortalUrl(url.url);
    if (!allowed) throw new Error("Secure billing could not open.");
    return { url: allowed };
  });
