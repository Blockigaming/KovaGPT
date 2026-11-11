import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_GROUPS } from "../../src/lib/notification-catalog.mjs";
const sql = readFileSync("supabase/migrations/20261110233000_kova_notification_campaigns.sql", "utf8");
const server = readFileSync("src/lib/notification-campaigns.functions.ts", "utf8");
const bridge = readFileSync("src/components/AnnouncementCampaignBridge.tsx", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");

test("all announcement identifiers are valid for server-controlled campaigns", () => {
  assert.equal(NOTIFICATION_GROUPS.announcements.length,23);
  for (const id of NOTIFICATION_GROUPS.announcements) {
    assert.match(sql, new RegExp("'"+id+"'"),"missing campaign type "+id);
  }
});
test("new release campaigns are disabled by default and inaccessible to clients", () => {
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/row level security/);
  assert.match(sql,/revoke all on public.kova_notification_campaigns from public,anon,authenticated/);
  assert.match(sql,/revoke all on public.kova_notification_campaign_dismissals from public,anon,authenticated/);
});
test("server gates campaigns on verified user, effective plan, expiry and saved dismissals", () => {
  assert.match(server,/requireSupabaseAuth/);
  assert.match(server,/monthlyIntroBillingEnabled/);
  assert.match(server,/user_subscription_summary/);
  assert.match(server,/kova_monthly_subscription_summary/);
  assert.match(server,/\.eq\("enabled", true\)\.lte\("starts_at", now\)\.gt\("ends_at", now\)/);
  assert.match(server,/allowed_tiers/);
  assert.match(server,/kova_notification_campaign_dismissals/);
});
test("only the first campaign is shown; action is safe and dismissal saves across devices",()=>{
  assert.match(bridge,/campaigns\.slice\(0, 1\)/);
  assert.match(bridge,/dismissAnnouncementCampaign/);
  assert.match(bridge,/campaignId: campaign\.id/);
  assert.match(server,/safePersistedNoticeActionUrl/);
  assert.match(root,/AnnouncementCampaignBridge/);
});
