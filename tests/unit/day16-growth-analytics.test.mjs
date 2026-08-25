import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const growth = fs.readFileSync("src/lib/growth-events.ts", "utf8");
const feature = fs.readFileSync("src/lib/feature-analytics.ts", "utf8");
const attribution = fs.readFileSync("src/components/GrowthAttribution.tsx", "utf8");

test("growth events remain metadata-only and bounded", () => {
  assert.match(growth, /sanitizeGrowthMetadata/);
  assert.match(growth, /ALLOWED_KEYS/);
  assert.doesNotMatch(
    growth,
    /["'](?:prompt|response|message|content|body|token|secret|email)["']\s*,/,
  );
});

test("growth analytics honors do-not-track and cannot block product actions", () => {
  assert.match(growth, /navigator\.doNotTrack === "1"/);
  assert.match(growth, /catch\s*\{/);
});

test("referral attribution tracks ref and campaign without private content", () => {
  assert.match(growth, /searchParams\.get\("ref"\)/);
  assert.match(growth, /utm_campaign/);
  assert.match(attribution, /referral_landed/);
});

test("feature attribution records the last feature before an upgrade", () => {
  assert.match(feature, /FEATURE_KEY/);
  assert.match(feature, /feature_used/);
  assert.match(feature, /feature_before_upgrade/);
  assert.match(feature, /sessionStorage/);
  assert.match(feature, /MAX_AGE_MS/);
});
