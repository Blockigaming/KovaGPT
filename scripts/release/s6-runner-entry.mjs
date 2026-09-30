import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  IsolatedDatabase,
  S6Run,
  TARGET,
  PROJECT,
  ORIGIN,
  validateWatchdog,
} from "./s6-deployed-checks.mjs";
import { realtimeProbe } from "./s6-realtime-probe.mjs";

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
  if (manifest) {
    assert.equal(manifest.target, TARGET);
    assert.equal(manifest.sourceSha, sourceSha);
    assert.ok(
      !existsSync(manifest.ownerBaseline) && !existsSync(manifest.ownerReceipt),
      "owner receipt must be fresh",
    );
    const baseline = run.prepareOwner(manifest.ownerEmail);
    writeFileSync(manifest.ownerBaseline, JSON.stringify(baseline, null, 2), { mode: 0o600 });
    console.log(
      JSON.stringify({
        ownerSessionReady: true,
        ownerBaseline: manifest.ownerBaseline,
        origin: ORIGIN,
        deadline,
      }),
    );
  }
  try {
    const version = await run.app("/api/version");
    assert.equal(version.status, 200);
    assert.ok(JSON.stringify(version.data).includes(sourceSha), "unexpected deployed source");
    await run.check("public_login_and_signup", () => run.signupCheck());
    await run.check("legacy_mfa_bridge", () => run.legacyCheck());
    await run.check("hosted_bearer_denied_after_retirement", () => run.hostedCheck());
    await run.check("storage_revocation_and_url_lifetime", () => run.storageCheck());
    await run.check("realtime_reauthorization", () => realtimeProbe(run));
    if (manifest) {
      // One owner session can run concurrently with all API-only fixtures.
      const ownerEnd = Math.min(Date.now() + 480000, deadline - 360000);
      while (!existsSync(manifest.ownerReceipt) && Date.now() < ownerEnd)
        await new Promise((r) => setTimeout(r, 1000));
      if (existsSync(manifest.ownerReceipt)) {
        const receipt = JSON.parse(readFileSync(manifest.ownerReceipt, "utf8"));
        for (const check of [
          "passkey_registration",
          "passkey_login_and_removal",
          "google_callback_and_consent",
        ]) {
          const row = receipt.find((x) => x.check === check);
          assert.ok(row && row.kind === "DEPLOYED" && row.status === "PASS");
          assert.equal(row.sourceSha, sourceSha);
          assert.ok(Date.parse(row.at) > Date.parse(run.ownerFixture.createdAfter));
          run.records.push(row);
        }
        run.save();
      }
      await run.check("rollback_rehearsal", () => run.rollbackCheck(transition));
    }
  } finally {
    try {
      await run.cleanup();
    } finally {
      try {
        if (manifest && !run.rollbackRestored) await transition("restore");
      } finally {
        db.close();
        await run.dispatcher.close();
      }
    }
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
