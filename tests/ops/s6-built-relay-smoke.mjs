// Loopback-only probe of the real Node build. This never starts an Azure app.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { OwnerRelayClient } from "../../scripts/release/s6-owner-relay-client.mjs";
import { ORIGIN } from "../../scripts/release/s6-deployed-checks.mjs";

assert.equal(process.argv[2], "--offline-only");
const port = 43117,
  now = Date.now(),
  key = randomBytes(32).toString("base64url");
const sourceSha = "a".repeat(40);
const child = spawn(process.execPath, ["dist/server/index.mjs"], {
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    KOVA_AUTH_MODE: "kova",
    KOVA_AUTH_PUBLIC_ORIGIN: ORIGIN,
    KOVA_AUTH_ORIGIN: ORIGIN,
    KOVA_AUTH_REVERSE_PROXY_ORIGIN: ORIGIN,
    KOVA_S6_OWNER_RELAY_KEY: key,
    KOVA_S6_OWNER_RELAY_DEADLINE: new Date(now + 1000000).toISOString(),
    KOVA_S6_SOURCE_SHA: sourceSha,
    SUPABASE_URL: "https://oztdrjtdglkizlewnulh.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "offline-only-placeholder",
    KOVA_GOOGLE_CLIENT_ID: "",
    KOVA_GOOGLE_CLIENT_SECRET: "",
    AI_GENERATION_ENABLED: "false",
  },
});
let owner;
const localRequest = (url, options) =>
  new Promise((resolve, reject) => {
    assert.equal(new URL(url).origin, ORIGIN);
    const r = request(
      {
        hostname: "127.0.0.1",
        port,
        path: new URL(url).pathname,
        method: options.method,
        headers: { ...options.headers, Host: new URL(ORIGIN).host, "X-Forwarded-Proto": "https" },
        timeout: 5000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (data) => chunks.push(data));
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers,
            }),
          ),
        );
      },
    );
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("loopback_timeout")));
    r.end(options.body);
  });
const coordinator = new OwnerRelayClient(key, localRequest);
const hardStop = setTimeout(() => child.kill("SIGKILL"), 30000);
try {
  const end = Date.now() + 12000;
  let ready = false;
  while (Date.now() < end) {
    try {
      assert.equal((await coordinator.call()).status, "empty");
      ready = true;
      break;
    } catch {
      if (child.exitCode !== null) throw new Error("local_server_exited");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(ready, "local_server_not_ready");
  const invitation = await coordinator.open("abcdef012345", {
    origin: ORIGIN,
    runId: "abcdef012345",
    expectedEmail: "s6-loopback@example.invalid",
    expectedAccountId: "10000000-0000-4000-8000-000000000001",
    sourceSha,
    capturedAt: new Date().toISOString(),
    deadline: now + 700000,
    existingAccounts: 0,
    existingHostedUsers: 0,
    authorizedDisposableGoogleIdentity: true,
  });
  owner = new OwnerRelayClient(invitation.ticket, localRequest);
  const baseline = await owner.claim(invitation);
  assert.equal(baseline.expectedEmail, "s6-loopback@example.invalid");
  assert.equal((await coordinator.call()).status, "claimed");
  await owner.call({ action: "fail", runId: invitation.runId });
  assert.equal((await coordinator.call()).status, "failed");
  await coordinator.call({ action: "close", runId: invitation.runId });
  assert.equal((await coordinator.call()).status, "empty");
  const result = {
    kind: "OFFLINE_BUILT_NODE_RELAY",
    status: "PASS",
    azureAppStarted: false,
    physicalOrGoogleChecksExecuted: false,
    checked: [
      "actual Node proxy-origin mapping",
      "one-use invitation claim",
      "failure receipt transfer",
      "in-memory cleanup",
    ],
  };
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await owner?.close();
  await coordinator.close();
  clearTimeout(hardStop);
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
