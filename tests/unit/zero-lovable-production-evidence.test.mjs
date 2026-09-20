import assert from "node:assert/strict";
import test from "node:test";
import { collectZeroLovableProductionEvidence } from "../../scripts/release/zero-lovable-production.mjs";

const sha = "a".repeat(40);

function response(body, init = {}) {
  return new Response(body, { status: 200, ...init });
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("production evidence passes only with exact SHA, absent retired routes, and clean assets", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      }
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/")) return response('<script src="/assets/app.js"></script>');
      if (url.endsWith("/assets/app.js")) return response('import("/assets/chunk.js")');
      if (url.endsWith("/assets/chunk.js")) return response("export const clean = true;");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
        now: () => new Date("2026-09-20T00:00:00.000Z"),
      }),
  );
  assert.equal(evidence.pass, true);
  assert.equal(evidence.exactSha, true);
  assert.equal(evidence.assetScan.count, 2);
  assert.deepEqual(evidence.failures, []);
});

test("production evidence fails closed on stale SHA, live legacy route, and hidden chunk content", async () => {
  const stale = "b".repeat(40);
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha: stale }), { headers: { "x-kova-build": stale } });
      }
      if (url.endsWith("/.lovable/oauth/consent")) {
        return response("", { status: 307, headers: { location: "/oauth/consent" } });
      }
      if (url.includes("/lovable/email/")) return response("gone", { status: 410 });
      if (url.endsWith("/")) return response('<script src="/assets/app.js"></script>');
      if (url.endsWith("/assets/app.js")) return response("legacy LOVABLE runtime marker");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.equal(evidence.exactSha, false);
  assert.ok(evidence.failures.includes("version_sha_mismatch"));
  assert.ok(evidence.failures.includes("retired_route_not_404:/.lovable/oauth/consent"));
  assert.ok(evidence.failures.some((failure) => failure.startsWith("lovable_asset_content:")));
});

test("production evidence rejects mutable or non-HTTPS targets", async () => {
  await assert.rejects(
    collectZeroLovableProductionEvidence({ baseUrl: "http://kovagpt.example", expectedSha: sha }),
    /production_base_must_use_https/u,
  );
  await assert.rejects(
    collectZeroLovableProductionEvidence({
      baseUrl: "https://kovagpt.example",
      expectedSha: "main",
    }),
    /expected_sha_required/u,
  );
});
