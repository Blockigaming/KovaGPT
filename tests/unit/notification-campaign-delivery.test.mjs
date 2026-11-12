import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NOTIFICATION_GROUPS } from "../../src/lib/notification-catalog.mjs";
import { selectEligibleCampaignRows } from "../../src/lib/notification-campaign-policy.mjs";
import { safePersistedNoticeActionUrl } from "../../src/lib/persisted-notification-policy.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const firstOwner = "10000000-0000-4000-8000-000000000001";
const secondOwner = "10000000-0000-4000-8000-000000000002";
const migration = readFileSync(
  "supabase/migrations/20261110233000_kova_notification_campaigns.sql",
  "utf8",
);

// Use the actual SDK request encoding and the migrated tables. This adapter
// supplies the test billing summary and translates the verified HTTP filters.
function campaignHandlers(db) {
  const client = createClient("https://campaign-fixture.example.test", "fixture-public-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      async fetch(input, options) {
        const url = new URL(input);
        if (url.pathname.endsWith("/rpc/user_subscription_summary"))
          return Response.json({ effectiveTier: "free" });
        if (url.pathname.endsWith("/kova_notification_campaign_dismissals")) {
          assert.equal(options.method, "POST");
          assert.equal(url.searchParams.get("on_conflict"), "campaign_id,user_id");
          assert.match(new Headers(options.headers).get("prefer"), /resolution=ignore-duplicates/);
          const { campaign_id, user_id } = JSON.parse(options.body);
          await db.query(
            "insert into public.kova_notification_campaign_dismissals(campaign_id,user_id) values ($1,$2) on conflict do nothing",
            [campaign_id, user_id],
          );
          return new Response(null, { status: 201 });
        }
        assert.ok(url.pathname.endsWith("/kova_notification_campaigns"));
        const params = url.searchParams;
        assert.equal(params.get("enabled"), "eq.true");
        assert.equal(params.get("allowed_tiers"), "cs.{free}");
        assert.match(params.get("select"), /dismissed:kova_notification_campaign_dismissals\(\)$/);
        assert.equal(params.get("dismissed"), "is.null");
        assert.equal(params.get("order"), "starts_at.desc,id.asc");
        assert.equal(params.get("limit"), "20");
        const owner = params.get("dismissed.user_id").replace(/^eq\./u, "");
        const now = params.get("starts_at").replace(/^lte\./u, "");
        assert.equal(params.get("ends_at"), `gt.${now}`);
        const result = await db.query(
          `select id,event_id,release_id,title,body,action_path,allowed_tiers
           from public.kova_notification_campaigns c
           where enabled and starts_at <= $1::timestamptz and ends_at > $1::timestamptz
             and allowed_tiers @> array['free']::text[] and not exists (
               select 1 from public.kova_notification_campaign_dismissals d
               where d.campaign_id = c.id and d.user_id = $2::uuid
             )
           order by starts_at desc,id asc limit 20`,
          [now, owner],
        );
        return Response.json(result.rows);
      },
    },
  });
  return loadUiModule(
    "src/lib/notification-campaigns.functions.ts",
    {
      "@tanstack/react-start": {
        createServerFn() {
          let validate;
          const builder = {
            middleware: () => builder,
            validator(fn) {
              validate = fn;
              return builder;
            },
            handler: (fn) => (userId, data) => fn({ context: { userId }, data: validate(data) }),
          };
          return builder;
        },
      },
      zod: { z },
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
      "@/lib/supabase-loose": { loose: (value) => value },
      "@/integrations/supabase/client.server": { supabaseAdmin: client },
      "@/lib/stripe.server": { monthlyIntroBillingEnabled: () => false },
      "@/lib/billing-plans": { BILLING_PLANS: {} },
      "@/lib/notification-catalog.mjs": { NOTIFICATION_GROUPS },
      "@/lib/persisted-notification-policy.mjs": { safePersistedNoticeActionUrl },
      "@/lib/notification-campaign-policy.mjs": { selectEligibleCampaignRows },
    },
    { AbortSignal },
  );
}

test("every announcement can be discovered and dismissed under the correct account after the first page", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls",
    );
    await db.exec(migration);
    const eventIds = NOTIFICATION_GROUPS.announcements;
    assert.equal(eventIds.length, 23);
    await db.query(
      `insert into public.kova_notification_campaigns
         (event_id,release_id,title,body,action_path,starts_at,ends_at,enabled)
       select event_id,'test-release','Release details','Released feature details','/images',
         now() - ordinality * interval '1 second',now()+interval '1 day',true
       from unnest($1::text[]) with ordinality as events(event_id,ordinality)`,
      [eventIds],
    );
    await db.exec(`insert into public.kova_notification_campaigns
      (event_id,release_id,title,body,allowed_tiers,starts_at,ends_at,enabled)
      select 'whats_new','pro-' || i,'Pro-only release','Pro-only details',array['pro'],
        now(),now()+interval '1 day',true from generate_series(1,22) as i;
      insert into public.kova_notification_campaigns
      (event_id,release_id,title,body,starts_at,ends_at,enabled) values
        ('whats_new','disabled','Disabled release','Disabled details',now(),now()+interval '1 day',false),
        ('whats_new','expired','Expired release','Expired details',now()-interval '2 days',now()-interval '1 day',true),
        ('whats_new','future','Future release','Future details',now()+interval '1 day',now()+interval '2 days',true);`);

    const { listEligibleAnnouncementCampaigns, dismissAnnouncementCampaign } = campaignHandlers(db);
    const list = (owner = firstOwner) =>
      listEligibleAnnouncementCampaigns(owner, { expectedOwnerId: owner });
    const dismiss = (campaignId, owner = firstOwner) =>
      dismissAnnouncementCampaign(owner, { campaignId, expectedOwnerId: owner });
    const received = [];
    for (const eventId of eventIds) {
      const [campaign] = await list();
      assert.equal(campaign?.eventId, eventId);
      assert.equal(campaign.releaseId, "test-release");
      assert.equal(campaign.actionUrl, "/images");
      received.push(campaign.id);
      await dismiss(campaign.id);
    }
    assert.equal((await list()).length, 0);
    assert.equal((await list(secondOwner))[0].id, received[0]);
    assert.equal(
      (await listEligibleAnnouncementCampaigns(secondOwner, { expectedOwnerId: firstOwner }))
        .length,
      0,
    );
    await assert.rejects(
      dismissAnnouncementCampaign(secondOwner, {
        campaignId: received[0],
        expectedOwnerId: firstOwner,
      }),
      /account changed/u,
    );
    await dismiss(received[0]);
    const stored = await db.query(
      "select user_id,count(*)::int as count from public.kova_notification_campaign_dismissals group by user_id",
    );
    assert.deepEqual(stored.rows, [{ user_id: firstOwner, count: 23 }]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select id from public.kova_notification_campaigns"),
      /permission denied/u,
    );
    await assert.rejects(
      db.query("select campaign_id from public.kova_notification_campaign_dismissals"),
      /permission denied/u,
    );
  } finally {
    await db.close();
  }
});
