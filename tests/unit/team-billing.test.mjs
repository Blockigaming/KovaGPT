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
async function prepareTeamDatabase(db) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema kova_private;
      create table kova_private.auth_accounts(id uuid,primary_email text,deleted_at timestamptz,email_verified_at timestamptz,suspended_until timestamptz);
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
      create function public.kova_auth_directory_email(p_user uuid) returns text language sql security definer set search_path='' as $$
       select case when exists(select 1 from kova_private.auth_accounts where id=p_user) then
        (select primary_email from kova_private.auth_accounts where id=p_user and deleted_at is null and email_verified_at is not null)
       else (select email from auth.users where id=p_user and email_confirmed_at is not null and deleted_at is null) end $$;
      create function kova_private.verified_auth_user_for_email(p_email text) returns uuid language sql as $$
       select id from auth.users where lower(public.kova_auth_directory_email(id))=lower(p_email) $$;
      create table public.account_deletion_fences(user_id uuid);
      create table public.subscriptions(user_id uuid,environment text,status text,current_period_end timestamptz);
      create function public.billing_user_plan_tier(uuid) returns text language sql as $$select 'free'::text$$;
      create function public.family_owner_of(uuid) returns uuid language sql as $$select null::uuid$$;
      grant usage on schema kova_private to service_role;
      grant select on public.account_deletion_fences to service_role;`);
  await applyMigration(db, "20261107211137_kova_self_service_team_billing.sql");
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
}

async function applyMigration(db, filename) {
  await db.exec(
    await readFile(new URL("../../supabase/migrations/" + filename, import.meta.url), "utf8"),
  );
}

test("Team database enforces owner authority, paid seat capacity, verified invitations, and downgrades", async () => {
  const db = new PGlite();
  try {
    await prepareTeamDatabase(db);
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

test("workspace and campaign migrations retain workspace isolation, request recovery, and private state", async () => {
  const db = new PGlite();
  try {
    await prepareTeamDatabase(db);
    await db.exec(`
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
    `);
    await applyMigration(db, "20260722130000_product_completeness_reliability.sql");
    await db.exec(`
      grant select, insert, update, delete on public.app_notifications to authenticated;
      grant select, insert on public.notification_preferences to service_role;
      grant select on public.app_notifications to service_role;
    `);
    await applyMigration(db, "20261110224500_kova_verified_team_workspace_join_requests.sql");
    await applyMigration(db, "20261110233000_kova_notification_campaigns.sql");
    await applyMigration(db, "20261112022300_kova_workspace_join_review_current_authority.sql");
    await applyMigration(db, "20261112195600_kova_workspace_join_decision_notifications.sql");
    const [owner, requester, unrelated, anotherRequester, unverified] = ids;
    await db.query("update auth.users set email='outside@other.invalid' where id=$1", [unrelated]);
    await db.query("update team_workspaces set status='active' where id=$1", [team]);
    await db.query(
      "insert into team_verified_domains values ($1,'example.invalid',now(),'dns_txt','test-proof')",
      [team],
    );

    await db.exec("set role service_role");
    const discover = async (actor) =>
      (await db.query("select * from discover_verified_team_workspaces($1)", [actor])).rows;
    const request = async (actor) =>
      (await db.query("select request_verified_team_join($1,$2) id", [actor, team])).rows[0].id;
    const review = async (actor, id, approve) =>
      (await db.query("select review_verified_team_join($1,$2,$3) ok", [actor, id, approve]))
        .rows[0].ok;
    const claim = async (id) =>
      (await db.query("select claim_team_join_notification($1) request", [id])).rows[0].request;
    const decisionNotices = async () =>
      (
        await db.query(
          "select id, owner_id, type, action_url, safe_preview from app_notifications where expires_at is null order by created_at",
        )
      ).rows;

    assert.deepEqual(await discover(owner), []);
    assert.deepEqual(await discover(unrelated), []);
    assert.deepEqual(await discover(unverified), []);
    assert.deepEqual(await discover(requester), [
      { team_id: team, team_name: "Test", request_status: "none" },
    ]);
    await assert.rejects(request(unverified), /Verify your email/);
    await assert.rejects(request(unrelated), /No verified workspace/);
    const id = await request(requester);
    assert.equal(await request(requester), id);
    assert.equal((await discover(requester))[0].request_status, "pending");
    assert.equal((await claim(id)).notification_attempts, 1);
    assert.equal(await claim(id), null);
    await db.query(
      "update team_join_requests set notification_lease_until=now()-interval '1 second' where id=$1",
      [id],
    );
    assert.equal((await claim(id)).notification_attempts, 2);
    await assert.rejects(review(unrelated, id, true), /Only the verified workspace owner/);
    assert.deepEqual(await decisionNotices(), []);
    await db.exec("begin");
    assert.equal(await review(owner, id, true), true);
    assert.equal((await decisionNotices()).length, 1);
    await db.exec("rollback");
    assert.deepEqual(await decisionNotices(), []);
    assert.equal((await discover(requester))[0].request_status, "pending");
    assert.equal(await review(owner, id, true), true);
    await assert.rejects(review(owner, id, true), /Request is no longer pending/);
    assert.equal(await request(requester), id);
    assert.equal((await discover(requester))[0].request_status, "approved");
    assert.equal(await claim(id), null);
    assert.deepEqual((await db.query("select * from team_members")).rows, []);
    const [approved] = await decisionNotices();
    assert.deepEqual(approved, {
      id: approved.id,
      owner_id: requester,
      type: "workspace_join_approved",
      action_url: "/settings/connections",
      safe_preview: "You can join after the workspace owner sends an invitation.",
    });

    const deniedId = await request(anotherRequester);
    assert.equal(await review(owner, deniedId, false), true);
    assert.deepEqual(
      (await decisionNotices()).map(({ owner_id, type }) => [owner_id, type]),
      [
        [requester, "workspace_join_approved"],
        [anotherRequester, "workspace_join_denied"],
      ],
    );
    await assert.rejects(request(anotherRequester), /Try again after the review period/);
    await db.query(
      "update team_join_requests set reviewed_at=now()-interval '8 days' where id=$1",
      [deniedId],
    );
    assert.equal(await request(anotherRequester), deniedId);
    assert.deepEqual(await decisionNotices(), [approved]);
    await db.query(
      "insert into notification_preferences(user_id,in_app_enabled) values($1,false)",
      [anotherRequester],
    );
    assert.equal(await review(owner, deniedId, true), true);
    assert.deepEqual(await decisionNotices(), [approved]);

    const campaign = (
      await db.query(
        "insert into kova_notification_campaigns (event_id,release_id,title,body,ends_at) values ('whats_new','test','Release','Details',now()+interval '1 day') returning id,enabled",
      )
    ).rows[0];
    assert.equal(campaign.enabled, false);
    await db.query("insert into kova_notification_campaign_dismissals values ($1,$2,now())", [
      campaign.id,
      requester,
    ]);
    await assert.rejects(
      db.query("insert into kova_notification_campaign_dismissals values ($1,$2,now())", [
        campaign.id,
        requester,
      ]),
      { code: "23505" },
    );
    await db.query("insert into kova_notification_campaign_dismissals values ($1,$2,now())", [
      campaign.id,
      anotherRequester,
    ]);

    await db.exec("reset role");
    await db.query("update auth.users set email='eligible@example.invalid' where id=$1", [
      unrelated,
    ]);
    await db.exec("set role service_role");
    const staleId = await request(unrelated);
    await db.exec("reset role");
    await db.query("update auth.users set email='changed@other.invalid' where id=$1", [unrelated]);
    await db.exec("set role service_role");
    assert.deepEqual(await discover(unrelated), []);
    await assert.rejects(review(owner, staleId, true), /Request eligibility has changed/);
    assert.equal(await review(owner, staleId, false), true);
    assert.deepEqual(await decisionNotices(), [approved]);

    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [unrelated]);
    assert.deepEqual(await decisionNotices(), []);
    assert.equal(
      (await db.query("update app_notifications set read_at=now() where id=$1", [approved.id]))
        .affectedRows,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [requester]);
    assert.deepEqual(await decisionNotices(), [approved]);
    assert.equal(
      (await db.query("update app_notifications set read_at=now() where id=$1", [approved.id]))
        .affectedRows,
      1,
    );
    await assert.rejects(
      db.query("update app_notifications set type='workspace_join_denied' where id=$1", [
        approved.id,
      ]),
      { code: "42501" },
    );
    for (const table of [
      "team_verified_domains",
      "team_join_requests",
      "kova_notification_campaigns",
      "kova_notification_campaign_dismissals",
    ])
      await assert.rejects(db.query("select * from public." + table), { code: "42501" });
    await assert.rejects(discover(requester), { code: "42501" });
    await assert.rejects(request(requester), { code: "42501" });
    await assert.rejects(review(owner, id, true), { code: "42501" });
  } finally {
    await db.close();
  }
});
