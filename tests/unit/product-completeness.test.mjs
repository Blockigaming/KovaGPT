import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/product-completeness.server.ts", "utf8");

test("onboarding covers real product steps and excludes voice", () => {
  for (const step of [
    "welcome",
    "appearance",
    "response_preferences",
    "projects",
    "library_files",
    "search_research",
    "temporary_chat",
    "connected_apps",
    "scheduled_tasks",
    "complete",
  ]) {
    assert.match(source, new RegExp(`id: "${step}"|"${step}"`));
  }
  const onboardingBlock = source.slice(
    source.indexOf("export const ONBOARDING_STEPS"),
    source.indexOf("export function shouldShowOnboarding"),
  );
  assert.doesNotMatch(onboardingBlock, /voice|microphone|dictation|read aloud/i);
  assert.match(source, /shouldShowOnboarding/);
  assert.match(source, /advanceOnboarding/);
});

test("guided empty states exist for major workspaces", () => {
  for (const route of [
    "chat",
    "projects",
    "project_detail",
    "library",
    "images",
    "apps",
    "scheduled_tasks",
    "canvas",
    "notifications",
    "settings",
    "shared_chats",
    "audit_history",
  ]) {
    assert.match(source, new RegExp(`${route}:|"${route}"`));
  }
  assert.match(source, /primaryAction/);
  assert.match(source, /secondaryAction/);
});

test("global search has authorization filtering and grouping", () => {
  assert.match(source, /filterAuthorizedSearchResults/);
  assert.match(source, /ownerId !== userId/);
  assert.match(source, /projectId && !projectIds\.includes/);
  assert.match(source, /groupSearchResults/);
});

test("notifications, support, feedback, admin, moderation, and safety contracts are safe", () => {
  for (const symbol of [
    "safeNotificationPreview",
    "sanitizeSupportText",
    "requireAdminPermission",
    "accountStatusAllowsWrite",
    "SafetyReportReason",
  ]) {
    assert.match(source, new RegExp(symbol));
  }
  assert.match(source, /\[redacted\]/);
  assert.match(source, /roles\.includes\("admin"\)/);
  assert.match(source, /permanently_banned/);
});

test("reliability and reconciliation contracts distinguish runtime and deployment blockers", () => {
  for (const symbol of [
    "routeErrorMessage",
    "rollbackOptimistic",
    "PERFORMANCE_CONTRACTS",
    "FEATURE_RECONCILIATION",
  ]) {
    assert.match(source, new RegExp(symbol));
  }
  assert.match(source, /blocked_external_access/);
  assert.match(source, /blocked_runtime_dependency/);
  assert.match(source, /deferred_product/);
  assert.match(source, /voice:\s*"deferred_product"/);
  assert.doesNotMatch(source, /voice:\s*"implemented_source"/);
});
