import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("account export ingress is authenticated, bounded, rate-limited, and no-store", async () => {
  const route = await read("src/routes/api/account/export.ts");
  assert.match(route, /requireUser\(request\)/u);
  assert.match(route, /isCrossSiteMutation\(request\)/u);
  assert.match(route, /readBoundedJsonObject\(request, 512\)/u);
  assert.match(route, /account_data_export/u);
  assert.match(route, /windowSeconds: 86_400/u);
  assert.match(route, /"Cache-Control": "no-store"/u);
  assert.match(route, /createSignedUrl\(result\.data\.storage_path, 300\)/u);
  assert.doesNotMatch(route, /getPublicUrl/u);
  assert.ok(
    route.indexOf('.update({\n            status: "canceled"') <
      route.indexOf("await clearAccountExportArtifacts(auth.userId, body.id)"),
    "cancellation must revoke database access before deleting every attempt artifact",
  );
});

test("the worker uses leases, private storage, redaction, and truthful settlement", async () => {
  const worker = await read("src/lib/account-export.server.ts");
  assert.match(worker, /claim_account_export_jobs/u);
  assert.match(worker, /settle_account_export_success/u);
  assert.match(worker, /settle_account_export_failure/u);
  assert.match(worker, /sanitizeAccountExportValue/u);
  assert.match(worker, /account-exports/u);
  assert.match(worker, /upsert: false/u);
  assert.match(worker, /clearAccountExportArtifacts/u);
  assert.match(worker, /settled\.data === "queued"/u);
  assert.match(worker, /createHash\("sha256"\)/u);
  assert.match(
    worker,
    /row\.status === "ready"[\s\S]*row\.kind === "file"[\s\S]*row\.kind === "image"/u,
  );
  assert.match(worker, /OAuth credentials, access tokens/u);
});

test("the internal export runner fails closed behind a dedicated or cron secret", async () => {
  const route = await read("src/routes/api/internal/account-exports.ts");
  assert.match(route, /ACCOUNT_EXPORT_WORKER_SECRET/u);
  assert.match(route, /CRON_SECRET/u);
  assert.match(route, /timingSafeEqualText/u);
  assert.match(route, /account_export_worker_not_configured/u);
  assert.doesNotMatch(route, /request\.text\(/u);
});

test("readiness and product ledgers classify cloud export truthfully", async () => {
  const readiness = await read("src/lib/readiness.server.ts");
  const capability = await read("docs/feature-parity.md");
  const parity = await read("docs/chatgpt-feature-parity.md");
  assert.match(
    readiness,
    /accountExports: capability\(any\("ACCOUNT_EXPORT_WORKER_SECRET", "CRON_SECRET"\)\)/u,
  );
  assert.match(capability, /private asynchronous cloud-account export backend/u);
  assert.match(
    capability,
    /Production migration, worker scheduling, and multi-account verification remain required/u,
  );
  assert.match(parity, /production migration, worker scheduling, authenticated UI wiring/u);
});
