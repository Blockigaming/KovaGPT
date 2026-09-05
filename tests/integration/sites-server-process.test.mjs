import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test("standalone Sites process boots with isolated fixture origins and rejects raw or foreign hosts", async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["sites-server/index.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PORT: String(port),
      NODE_ENV: "test",
      KOVA_SITES_HOSTING_ENABLED: "true",
      KOVA_SITES_ISOLATION_APPROVED: "true",
      KOVA_SITES_APP_ORIGIN: "https://kova-app.invalid",
      KOVA_SITES_ASSET_ORIGIN: "https://kova-pages.invalid",
      SUPABASE_URL: "https://database.example.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "ci-fixture-only",
    },
  });
  let logs = "";
  child.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-2000);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (response?.ok || child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(response?.ok, logs || "asset process did not start");
  assert.deepEqual(await response.json(), { ok: true, service: "kova-sites-assets" });
  for (const host of [`127.0.0.1:${port}`, "foreign.invalid", "kova-pages.invalid"]) {
    const denied = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Host: host },
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(denied.status, 404);
  }
});
