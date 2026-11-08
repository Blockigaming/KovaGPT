import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  TEAM_PRICES,
  validateTeamSelection,
  validateTeamPrice,
  teamCheckoutUrl,
} from "../../src/lib/team-billing-policy.mjs";
const ids = [1, 2, 3, 4, 5].map((n) => `11111111-1111-4111-8111-11111111111${n}`);
const team = "22222222-2222-4222-8222-222222222222";
test("Team selection enforces bounds and the exact four seat prices", () => {
  assert.deepEqual(validateTeamSelection({ standard: 2, premium: 1, interval: "year" }), {
    standard: 2,
    premium: 1,
    interval: "year",
  });
  for (const value of [
    { standard: 1, premium: 0, interval: "month" },
    { standard: 150, premium: 1, interval: "year" },
    { standard: -1, premium: 3, interval: "month" },
    { standard: 1.5, premium: 1, interval: "month" },
    { standard: 2, premium: 0, interval: "day" },
  ])
    assert.throws(() => validateTeamSelection(value));
  assert.deepEqual(
    Object.values(TEAM_PRICES).map((v) => v.amount),
    [2500, 24000, 12500, 120000],
  );
  for (const definition of Object.values(TEAM_PRICES)) {
    const price = {
      id: "price_Test",
      active: true,
      livemode: true,
      currency: "usd",
      lookup_key: definition.key,
      unit_amount: definition.amount,
      billing_scheme: "per_unit",
      recurring: { interval: definition.interval, interval_count: 1, usage_type: "licensed" },
    };
    assert.equal(validateTeamPrice(price, definition), "price_Test");
    for (const patch of [
      { unit_amount: 1 },
      { livemode: false },
      { currency: "eur" },
      { active: false },
      { lookup_key: "unknown" },
    ])
      assert.throws(() => validateTeamPrice({ ...price, ...patch }, definition));
  }
  assert.equal(
    teamCheckoutUrl("https://checkout.stripe.com/c/pay/test"),
    "https://checkout.stripe.com/c/pay/test",
  );
  assert.throws(() => teamCheckoutUrl("https://checkout.stripe.com.evil.example"));
});
test("Team database enforces owner authority, paid seat capacity, verified invitations, and downgrades", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema kova_private;
      create table kova_private.auth_accounts(id uuid,primary_email text,deleted_at timestamptz,email_verified_at timestamptz,suspended_until timestamptz);
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
      create function public.kova_auth_directory_email(p_user uuid) returns text language sql as $$
       select case when exists(select 1 from kova_private.auth_accounts where id=p_user) then
        (select primary_email from kova_private.auth_accounts where id=p_user and deleted_at is null and email_verified_at is not null)
       else (select email from auth.users where id=p_user and email_confirmed_at is not null and deleted_at is null) end $$;
      create function kova_private.verified_auth_user_for_email(p_email text) returns uuid language sql as $$
       select id from auth.users where lower(public.kova_auth_directory_email(id))=lower(p_email) $$;
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
    for (const [i, id] of ids.entries())
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
        id,
        `member${i}@example.invalid`,
        i === 4 ? null : new Date().toISOString(),
      ]);
    await db.query(
      "insert into team_workspaces(id,owner_id,name,customer_id) values($1,$2,'Test','cus_Test')",
      [team, ids[0]],
    );
    const reconcile = (standard, premium) =>
      db.query(
        "select reconcile_team_subscription($1,'cus_Test','sub_Test','active',$2,$3,now()+interval '1 month',clock_timestamp())",
        [team, standard, premium],
      );
    await reconcile(2, 1);
    const invite = (actor, email, seat = "standard") =>
      db.query("select mutate_team_member($1,$2,'invite',$3,null,$4)", [actor, team, email, seat]);
    await assert.rejects(invite(ids[1], "member2@example.invalid"), /Only the team owner/);
    await assert.rejects(invite(ids[0], "member4@example.invalid"), /verified KovaGPT account/);
    await invite(ids[0], "member1@example.invalid");
    await invite(ids[0], "member1@example.invalid"); // exact retry does not consume another seat
    await assert.rejects(invite(ids[0], "member2@example.invalid"), /No unassigned seats/);
    assert.equal(
      (await db.query("select effective_user_plan_tier($1) tier", [ids[1]])).rows[0].tier,
      "free",
    );
    await db.query("select mutate_team_member($1,$2,'accept')", [ids[1], team]);
    assert.equal(
      (await db.query("select effective_user_plan_tier($1) tier", [ids[1]])).rows[0].tier,
      "pro",
    );
    await invite(ids[0], "member2@example.invalid", "premium");
    await reconcile(1, 1);
    assert.equal(
      (
        await db.query("select state from team_members where team_id=$1 and user_id=$2", [
          team,
          ids[1],
        ])
      ).rows[0].state,
      "removed",
    );
    assert.equal(
      (await db.query("select effective_user_plan_tier($1) tier", [ids[1]])).rows[0].tier,
      "free",
    );
    await db.query("update team_workspaces set status='past_due' where id=$1", [team]);
    assert.equal(
      (await db.query("select effective_user_plan_tier($1) tier", [ids[0]])).rows[0].tier,
      "free",
    );
    await assert.rejects(
      invite(ids[0], "member3@example.invalid", "premium"),
      /Complete team payment/,
    );
    await db.query("insert into account_deletion_fences(user_id) values($1)", [ids[0]]);
    await assert.rejects(
      db.query("update team_workspaces set checkout_session='cs_raced' where id=$1", [team]),
      /Account deletion has started/,
    );
    const privileges = (
      await db.query(
        "select has_table_privilege('authenticated','team_workspaces','INSERT') allowed",
      )
    ).rows[0];
    assert.equal(privileges.allowed, false);
  } finally {
    await db.close();
  }
});
