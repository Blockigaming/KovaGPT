import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  renderTeamInvitation,
  teamSubscriptionSnapshot,
  teamInvoicePaymentUrl,
  teamInvitationUpdate,
} from "../../src/lib/team-invitation-policy.mjs";
import { settleTeamInvitation } from "../../src/lib/team-invitation-workflow.mjs";
const price = {
  id: "price_standard",
  active: true,
  livemode: true,
  currency: "usd",
  lookup_key: "kova_team_standard_monthly",
  unit_amount: 2500,
  billing_scheme: "per_unit",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};
const subscription = () => ({
  id: "sub_team",
  customer: "cus_team",
  livemode: true,
  status: "active",
  items: { has_more: false, data: [{ id: "si_standard", price, quantity: 2 }] },
  latest_invoice: { id: "in_paid", customer: "cus_team", status: "paid" },
});
function fixture({ needsSeat = true } = {}) {
  const sub = subscription(),
    calls = [];
  const invite = {
    id: "invitation",
    state: "billing",
    needs_seat: needsSeat,
    customer_id: "cus_team",
    subscription_id: "sub_team",
    seat: "standard",
    base_standard: 2,
    base_premium: 0,
    target_standard: needsSeat ? 3 : 2,
    target_premium: 0,
    proration_date: 123,
    dispatched_at: new Date().toISOString(),
    quote: {
      interval: "month",
      priceId: price.id,
      items: [{ id: "si_standard", price: price.id, quantity: 2, kind: "standard" }],
    },
  };
  const deps = {
    stripe: {
      subscriptions: {
        retrieve: async () => sub,
        update: async (id, params, opts) => {
          calls.push({ id, params, opts });
          sub.items.data[0].quantity = 3;
          return sub;
        },
      },
      invoices: { retrieve: async () => sub.latest_invoice },
    },
    reconcile: async () => calls.push("reconcile"),
    finalize: async () => {
      calls.push("finalize");
      return true;
    },
    saveInvoice: async () => calls.push("save"),
    dispatch: true,
  };
  return { sub, invite, deps, calls };
}
test("invitation email escapes names and uses a fixed acceptance origin without bearer links", () => {
  const body = renderTeamInvitation({
    teamName: "<img src=x> & Team",
    email: "member@example.invalid",
    seat: "standard",
  });
  assert.ok(body.html.includes("&lt;img src=x&gt; &amp; Team"));
  assert.ok(!body.html.includes("<img"));
  assert.ok(body.html.includes('href="https://kovagpt.com/team"'));
  assert.deepEqual(body.to, ["member@example.invalid"]);
  assert.throws(() =>
    renderTeamInvitation({
      teamName: "Team",
      email: "one@example.com,two@example.com",
      seat: "standard",
    }),
  );
  assert.throws(() => teamInvoicePaymentUrl("https://invoice.stripe.com.evil.example/pay"));
  assert.throws(() => teamInvoicePaymentUrl("https://user:pass@invoice.stripe.com/pay"));
});
test("subscription preview rejects test prices, mixed intervals, pending changes, and wrong customers", () => {
  assert.equal(teamSubscriptionSnapshot(subscription(), "cus_team").standard, 2);
  for (const patch of [
    { customer: "cus_other" },
    { livemode: false },
    { pending_update: {} },
    { cancel_at_period_end: true },
    { schedule: "sched" },
    { status: "past_due" },
  ])
    assert.throws(() => teamSubscriptionSnapshot({ ...subscription(), ...patch }, "cus_team"));
  const sub = subscription();
  sub.items.data[0].price = { ...price, unit_amount: 1 };
  assert.throws(() => teamSubscriptionSnapshot(sub, "cus_team"));
});
test("free paid capacity sends without a Stripe subscription write", async () => {
  const f = fixture({ needsSeat: false });
  assert.deepEqual(await settleTeamInvitation(f.invite, f.deps), { ready: true, paymentUrl: null });
  assert.deepEqual(f.calls, ["reconcile", "finalize"]);
});
test("paid seat update freezes reviewed proration and uses durable idempotency", async () => {
  const f = fixture();
  assert.equal((await settleTeamInvitation(f.invite, f.deps)).ready, true);
  const write = f.calls[0];
  assert.equal(write.params.payment_behavior, "pending_if_incomplete");
  assert.equal(write.params.proration_behavior, "always_invoice");
  assert.equal(write.params.proration_date, 123);
  assert.equal(write.opts.idempotencyKey, "kova-team-invite:invitation");
  assert.equal(write.params.items[0].quantity, 3);
  assert.deepEqual(f.calls.slice(-2), ["reconcile", "finalize"]);
});
test("pending payment never grants an invitation and returns only a validated Stripe invoice URL", async () => {
  const f = fixture();
  f.deps.stripe.subscriptions.update = async () => ({
    ...f.sub,
    pending_update: {},
    latest_invoice: {
      id: "in_pending",
      status: "open",
      hosted_invoice_url: "https://invoice.stripe.com/i/pay/test",
    },
  });
  const result = await settleTeamInvitation(f.invite, f.deps);
  assert.equal(result.ready, false);
  assert.equal(result.paymentUrl, "https://invoice.stripe.com/i/pay/test");
  assert.ok(!f.calls.includes("finalize"));
});
test("webhook or page refresh only reconciles and never initiates a seat charge", async () => {
  const f = fixture();
  f.deps.dispatch = false;
  assert.equal((await settleTeamInvitation(f.invite, f.deps)).ready, false);
  assert.ok(!f.calls.some((x) => typeof x === "object"));
});
test("a paid update recovered after a timeout does not charge twice", async () => {
  const f = fixture();
  f.sub.items.data[0].quantity = 3;
  assert.equal((await settleTeamInvitation(f.invite, f.deps)).ready, true);
  assert.ok(!f.calls.some((x) => typeof x === "object"));
});
test("unpaid, changed, stale, and wrong-owner billing cannot grant seats or repeat a charge", async () => {
  const f = fixture();
  f.sub.customer = "cus_other";
  await assert.rejects(settleTeamInvitation(f.invite, f.deps), /identity/);
  const changed = fixture();
  changed.sub.items.data[0].quantity = 1;
  await assert.rejects(settleTeamInvitation(changed.invite, changed.deps), /changed after review/);
  const stale = fixture();
  stale.invite.dispatched_at = new Date(Date.now() - 24 * 3600000).toISOString();
  await assert.rejects(settleTeamInvitation(stale.invite, stale.deps), /reconciliation/);
  const unpaid = fixture();
  unpaid.sub.items.data[0].quantity = 3;
  unpaid.sub.latest_invoice.status = "open";
  assert.equal((await settleTeamInvitation(unpaid.invite, unpaid.deps)).ready, false);
  assert.ok(!unpaid.calls.includes("finalize"));
});
test("adding the first Premium item preserves Standard seats", () => {
  const f = fixture();
  const params = teamInvitationUpdate({
    ...f.invite,
    seat: "premium",
    target_premium: 1,
    quote: { ...f.invite.quote, priceId: "price_premium" },
  });
  assert.deepEqual(params.items, [
    { id: "si_standard", quantity: 2 },
    { price: "price_premium", quantity: 1 },
  ]);
});
test("native invitation workflow reserves paid capacity, accepts new verified accounts, and fences authority", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema kova_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function public.kova_auth_directory_email(p_user uuid) returns text language sql as $$select email from auth.users where id=p_user and email_confirmed_at is not null$$;
 create function kova_private.verified_auth_user_for_email(p_email text) returns uuid language sql as $$select id from auth.users where lower(email)=lower(p_email) and email_confirmed_at is not null$$;
 create table public.account_deletion_fences(user_id uuid);
 create table public.subscriptions(user_id uuid,environment text,status text,current_period_end timestamptz);
 create function public.billing_user_plan_tier(uuid) returns text language sql as $$select 'free'::text$$;
 create function public.family_owner_of(uuid) returns uuid language sql as $$select null::uuid$$;`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261107211137_kova_self_service_team_billing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261108034500_team_email_invitations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const owner = "11111111-1111-4111-8111-111111111111",
      member = "11111111-1111-4111-8111-111111111112",
      other = "11111111-1111-4111-8111-111111111113",
      team = "22222222-2222-4222-8222-222222222222";
    await db.query(
      "insert into auth.users values($1,'owner@example.invalid',now()),($2,'other@example.invalid',now())",
      [owner, other],
    );
    await db.query(
      "insert into team_workspaces(id,owner_id,name,customer_id) values($1,$2,'Test','cus_team')",
      [team, owner],
    );
    await db.query(
      "select reconcile_team_subscription($1,'cus_team','sub_team','active',2,0,now()+interval '1 month',now())",
      [team],
    );
    const prepare = async (actor, email, seat = "standard") =>
      (
        await db.query("select prepare_team_email_invitation($1,$2,$3,$4,'{}') i", [
          actor,
          team,
          email,
          seat,
        ])
      ).rows[0].i;
    await assert.rejects(prepare(other, "member@example.invalid"), /owner/);
    const first = await prepare(owner, "member@example.invalid");
    assert.equal(first.needs_seat, false);
    assert.equal(first.target_standard, 2);
    assert.equal((await prepare(owner, "member@example.invalid")).id, first.id);
    await assert.rejects(prepare(owner, "second@example.invalid"), /pending invitation/);
    await db.query("update team_email_invitations set quote='{}' where id=$1", [first.id]);
    await db.query("select claim_team_email_invitation($1,$2)", [owner, first.id]);
    assert.equal(
      (await db.query("select finalize_team_email_invitation($1) ready", [first.id])).rows[0].ready,
      true,
    );
    await assert.rejects(
      db.query("select manage_team_email_invitation($1,$2,'accept')", [other, first.id]),
      /invited email/,
    );
    await db.query("insert into auth.users values($1,'member@example.invalid',null)", [member]);
    await assert.rejects(
      db.query("select manage_team_email_invitation($1,$2,'accept')", [member, first.id]),
      /Verify/,
    );
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [member]);
    assert.equal(
      (await db.query("select jsonb_array_length(list_team_email_invitations($1)) n", [member]))
        .rows[0].n,
      1,
    );
    await db.query("select manage_team_email_invitation($1,$2,'accept')", [member, first.id]);
    assert.equal(
      (await db.query("select effective_user_plan_tier($1) tier", [member])).rows[0].tier,
      "pro",
    );
    const second = await prepare(owner, "second@example.invalid");
    assert.equal(second.needs_seat, true);
    assert.equal(second.target_standard, 3);
    await db.query("update team_email_invitations set quote='{}' where id=$1", [second.id]);
    await db.query("select claim_team_email_invitation($1,$2)", [owner, second.id]);
    assert.equal(
      (await db.query("select finalize_team_email_invitation($1) ready", [second.id])).rows[0]
        .ready,
      false,
    );
    assert.equal(
      (await db.query("select claim_team_invitation_email($1) body", [second.id])).rows[0].body,
      null,
    );
    await db.query(
      "select reconcile_team_subscription($1,'cus_team','sub_team','active',3,0,now()+interval '1 month',clock_timestamp())",
      [team],
    );
    assert.equal(
      (await db.query("select finalize_team_email_invitation($1) ready", [second.id])).rows[0]
        .ready,
      true,
    );
    assert.ok(
      (await db.query("select claim_team_invitation_email($1) body", [second.id])).rows[0].body,
    );
    assert.equal(
      (await db.query("select claim_team_invitation_email($1) body", [second.id])).rows[0].body,
      null,
    );
    const premium = await prepare(owner, "premium@example.invalid", "premium");
    assert.equal(premium.target_premium, 1);
    await db.query("select manage_team_email_invitation($1,$2,'cancel')", [owner, premium.id]);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(prepare(owner, "blocked@example.invalid"), /owner/);
    const privilege = (
      await db.query(
        "select has_table_privilege('authenticated','team_email_invitations','SELECT') r,has_function_privilege('authenticated','claim_team_email_invitation(uuid,uuid)','EXECUTE') e",
      )
    ).rows[0];
    assert.equal(privilege.r, false);
    assert.equal(privilege.e, false);
  } finally {
    await db.close();
  }
});
