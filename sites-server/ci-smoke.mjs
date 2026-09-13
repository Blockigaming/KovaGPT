import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const container = "kovagpt-sites-ci";
const image = "kovagpt-sites:ci";
const docker = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 }).trim();
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
const [inspected] = JSON.parse(docker(["image", "inspect", image]));
assert.equal(inspected.Config.User, "node");
assert.equal(inspected.Config.Labels["org.opencontainers.image.revision"], sourceSha);
assert.equal(inspected.Config.Labels["com.kovagpt.source.tree"], sourceTree);
assert.match(inspected.Id, /^sha256:[a-f0-9]{64}$/u);
try {
  docker([
    "run",
    "-d",
    "--name",
    container,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--memory=256m",
    "--cpus=1",
    "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
    "-p",
    "127.0.0.1:3081:8081",
    "-e",
    "KOVA_SITES_HOSTING_ENABLED=true",
    "-e",
    "KOVA_SITES_ISOLATION_APPROVED=true",
    "-e",
    "KOVA_SITES_APP_ORIGIN=https://kova-app.invalid",
    "-e",
    "KOVA_SITES_ASSET_ORIGIN=https://kova-pages.invalid",
    "-e",
    "SUPABASE_URL=https://database.example.invalid",
    "-e",
    "SUPABASE_SERVICE_ROLE_KEY=ci-fixture-only",
    image,
  ]);
  let health;
  for (let attempt = 0; attempt < 30; attempt++) {
    health = await fetch("http://127.0.0.1:3081/health", {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (health?.ok) break;
    await delay(500);
  }
  assert.ok(health?.ok, "isolated asset process must become healthy");
  assert.deepEqual(await health.json(), { ok: true, service: "kova-sites-assets" });
  const raw = await fetch("http://127.0.0.1:3081/", { signal: AbortSignal.timeout(1000) });
  assert.equal(raw.status, 404, "raw host must not serve a Site");
  const foreign = await fetch("http://127.0.0.1:3081/", {
    headers: { Host: "foreign.example.invalid" },
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(foreign.status, 404, "unconfigured hosts must not serve a Site");
  await mkdir("artifacts/ci-container", { recursive: true });
  await writeFile(
    "artifacts/ci-container/sites-evidence.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        sourceSha,
        sourceTree,
        imageConfigDigest: inspected.Id,
        nonRoot: true,
        readOnlyRoot: true,
        health: "passed",
        hostIsolation: "passed",
        providerAccessTested: false,
        productionApproved: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Sites container build, source identity, health, and host rejection passed.");
} finally {
  try {
    docker(["rm", "-f", container]);
  } catch {
    /* Cleanup only this test container. */
  }
}
