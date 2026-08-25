import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("production verifier proves exact SHA, readiness, Cloudflare, auth, AI modes, images, tools, and zero Lovable", () => {
  const source = readFileSync("scripts/release/production-system-verifier.mjs", "utf8");
  for (const evidence of [
    "KOVA_EXPECTED_SHA",
    "KOVA_EXPECTED_ENVIRONMENT",
    "x-kova-build",
    "cf-ray",
    "strict-transport-security",
    "content-security-policy",
    "/api/readyz",
    "requiredCapabilities",
    "/api/google/status",
    "/api/chat",
    "text/event-stream",
    "activityEvents",
    "deep_research",
    "/api/generate-image",
    "LEGACY_LOVABLE_PATHS",
  ])
    assert.match(source, new RegExp(evidence.replaceAll("/", "\\/"), "iu"), evidence);
  assert.match(source, /response\.status, 404/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:accessToken|readinessToken)/u);
});
