import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const product = readFileSync("src/lib/product-completeness.server.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260722130000_product_completeness_reliability.sql",
  "utf8",
);
const help = readFileSync("src/routes/help.tsx", "utf8");

test("product-completeness migration adds owner-scoped tables with RLS", () => {
  for (const table of [
    "onboarding_progress",
    "app_notifications",
    "notification_preferences",
    "support_tickets",
    "feedback_submissions",
    "safety_reports",
    "app_admin_roles",
    "moderation_actions",
    "system_notices",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(migration, /exists \(select 1 from public\.app_admin_roles/);
  assert.doesNotMatch(migration, /using \(true\).*app_admin_roles/i);
});

test("help center source covers scoped features and omits voice documentation", () => {
  for (const topic of [
    "Getting started",
    "Deep Research",
    "Projects",
    "Files",
    "Images",
    "Data analysis",
    "Canvas",
    "Temporary Chat",
    "Memory",
    "Google",
    "Scheduled Tasks",
    "Sharing",
    "Billing",
  ]) {
    assert.match(help, new RegExp(topic, "i"));
  }
  assert.doesNotMatch(help, /\bvoice\b|microphone|dictation|read aloud/i);
});

test("support, feedback, admin, safety, and policy contracts avoid secret exposure", () => {
  for (const term of [
    "SupportCategory",
    "FeedbackReason",
    "AdminPermission",
    "SafetyReportReason",
    "AccountStatus",
    "UpgradeState",
  ]) {
    assert.match(product, new RegExp(term));
  }
  assert.match(product, /api\[_-\]\?key|oauth|session|token|secret|password/);
  assert.match(product, /No raw provider stack traces are shown/);
  assert.doesNotMatch(product, /clientOnlyAdmin|publicToken|oauth_token/i);
});
