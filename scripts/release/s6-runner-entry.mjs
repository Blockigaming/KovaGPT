import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import {
  IsolatedDatabase,
  S6Run,
  TARGET,
  PROJECT,
  ORIGIN,
  validateWatchdog,
} from "./s6-deployed-checks.mjs";
import { realtimeProbe } from "./s6-realtime-probe.mjs";
import { OwnerRelayClient } from "./s6-owner-relay-client.mjs";
import { executeS6 } from "./s6-coordinator.mjs";

async function main() {
  const [flag, guardPath, sourceSha, reportFile, manifestPath] = process.argv.slice(2);
  assert.equal(flag, "--execute-authorized");
  assert.ok(guardPath && reportFile);
  const deadline = validateWatchdog(JSON.parse(readFileSync(guardPath, "utf8")));
  const az = (args) =>
    JSON.parse(
      execFileSync("az", args, {
        encoding: "utf8",
        timeout: 35000,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  const app = az([
    "rest",
    "--method",
    "get",
    "--url",
    "https://management.azure.com" + TARGET + "?api-version=2024-03-01",
    "-o",
    "json",
  ]);
  assert.equal(app.id.toLowerCase(), TARGET.toLowerCase());
  assert.equal(app.properties.runningStatus, "Running");
  const env = Object.fromEntries(
    app.properties.template.containers[0].env.map((e) => [e.name, e.value]),
  );
  assert.equal(env.SUPABASE_URL, `https://${PROJECT}.supabase.co`);
  assert.equal(app.properties.configuration.ingress.allowInsecure, false);
  assert.equal(env.KOVA_AUTH_PUBLIC_ORIGIN, ORIGIN);
  const response = az([
    "rest",
    "--method",
    "post",
    "--url",
    "https://management.azure.com" + TARGET + "/listSecrets?api-version=2024-03-01",
    "-o",
    "json",
  ]);
  const secrets = Object.fromEntries(response.value.map((s) => [s.name, s.value]));
  const db = new IsolatedDatabase(
    secrets["auth-migration-rehearsal-database-url"],
    secrets["auth-migration-rehearsal-database-ca"],
  );
  const run = new S6Run({
    database: db,
    serviceKey: secrets["supabase-service-role-key"],
    apiKey: env.SUPABASE_PUBLISHABLE_KEY,
    deadline,
    sourceSha,
    reportFile,
  });
  const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const transition = async (action) => {
    assert.ok(manifest);
    const raw = execFileSync(
      "python3",
      [
        manifest.controlScript,
        action,
        "--guard",
        guardPath,
        "--plan",
        manifest.controlPlan,
        "--baseline",
        manifest.controlBaseline,
      ],
      { encoding: "utf8", timeout: 115000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return JSON.parse(raw.trim());
  };
  let relay;
  try {
    if (manifest) {
      assert.equal(manifest.target, TARGET);
      assert.equal(manifest.sourceSha, sourceSha);
      assert.ok(!existsSync(manifest.ownerInvitation), "owner invitation must be fresh");
      assert.equal(app.properties.template.scale.maxReplicas, 1);
      relay = new OwnerRelayClient(secrets["kova-s6-owner-relay-key"]);
    }
    await executeS6(run, { manifest, relay, transition, realtime: realtimeProbe });
  } finally {
    db.close();
    await run.dispatcher.close();
    await relay?.close();
  }
  console.log(
    JSON.stringify({
      target: TARGET,
      reportFile,
      checks: run.records.map(({ check, status }) => ({ check, status })),
      cleanupComplete: run.cleanupComplete,
    }),
  );
  if (run.records.some((x) => x.status !== "PASS")) process.exitCode = 2;
}
main().catch((error) => {
  console.error(
    JSON.stringify({ status: "FAILED", errorType: error.name, appStartRequested: false }),
  );
  process.exitCode = 2;
});
