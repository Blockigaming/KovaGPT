import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Stripe ordering metadata prevents stale entitlement updates", async () => {
  const route = await read("src/routes/api/public/payments/webhook.ts");
  const sql = await read("supabase/migrations/20260803121000_stripe_event_ordering.sql");

  assert.match(route, /last_stripe_event_created_at\.lte/u);
  assert.match(route, /event_created_at/u);
  assert.match(route, /23505/u);
  assert.match(sql, /last_stripe_event_created_at/u);
  assert.match(sql, /processed_stripe_events_order_idx/u);
});

test("edge contract enforces security headers CSRF and request size", async () => {
  const edge = await read("scripts/release/edge-contract.mjs");
  const server = await read("src/server.ts");

  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.match(server, new RegExp(header));
  }

  assert.match(server, /rejectCrossSiteRequest/u);
  assert.match(server, /16 \* 1024 \* 1024/u);
  assert.match(edge, /KOVA_EDGE_ALLOWED_HOSTS/u);
});

test("final production E2E matrix covers required engines, states, and viewports", async () => {
  const ci = await read(".github/workflows/final-release-ci.yml");
  const config = await read("playwright.release.config.ts");

  for (const required of [
    "npx playwright install --with-deps chromium firefox webkit",
    "npm run test:e2e:release:signed-out",
    "npm run test:e2e:release:signed-in",
  ]) {
    assert.ok(ci.includes(required), `final CI missing browser contract: ${required}`);
  }

  for (const engine of ["chromium", "firefox", "webkit"]) {
    assert.ok(config.includes(`"${engine}"`), `release config missing ${engine}`);
  }

  const viewportPairs = [
    "[320, 700]",
    "[375, 812]",
    "[390, 844]",
    "[768, 1024]",
    "[1024, 768]",
    "[1280, 800]",
    "[1440, 900]",
    "[1728, 1117]",
  ];

  for (const viewport of viewportPairs) {
    assert.ok(config.includes(viewport), `release config missing viewport ${viewport}`);
  }

  assert.match(config, /fullyParallel:\s*true/u);
  assert.match(config, /retries:\s*0/u);

  assert.match(config, /workers:\s*process\.env\.CI\s*\?\s*3\s*:\s*4/u);

  assert.ok(
    config.includes('browser-matrix-${authenticated ? "signed-in" : "signed-out"}.xml'),
    "release browser matrix must emit deterministic JUnit evidence",
  );

  assert.ok(config.includes("artifacts/release-browser-report"));
  assert.ok(config.includes("artifacts/release-browser-results"));

  assert.doesNotMatch(config, /--grep-invert/u);
});
