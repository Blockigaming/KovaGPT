import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const target = Object.freeze({
  subscription: "ab732127-11c3-46a7-a1cb-6ee8d86594f4",
  tenant: "18a67414-b56e-4b79-8dc8-435494fcc9be",
  group: "rg-kovagpt-prod",
  app: "kovagpt-prod-web",
  oldRevision: "kovagpt-prod-web--pr715-2e062bd",
  oldSha: "2e062bd207dda195f15b34d94e920f2778c1cac1",
  oldImage:
    "ghcr.io/blockigaming/kovagpt-web@sha256:f15a650d6886d9fcc7af05a1ab2ba4f0a10c6daaa564a14021d598d0bcf77fa8",
  origin: "https://kovagpt.com",
  fqdn: "kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io",
});
const select = ["--resource-group", target.group, "--name", target.app];
const oldTraffic = [{ revisionName: target.oldRevision, weight: 100 }];
const check = (condition, code) => {
  if (!condition) throw new Error(`pr716_${code}`);
};

export function validateBefore(account, app, revision) {
  check(
    account.id === target.subscription && account.tenantId === target.tenant,
    "account_mismatch",
  );
  check(
    app.name === target.app &&
      app.id.toLowerCase() ===
        `/subscriptions/${target.subscription}/resourceGroups/${target.group}/providers/Microsoft.App/containerApps/${target.app}`.toLowerCase(),
    "target_mismatch",
  );
  const { configuration: c, template: t } = app.properties;
  check(
    c.activeRevisionsMode === "Multiple" &&
      c.ingress.external === true &&
      c.ingress.allowInsecure === false &&
      c.ingress.targetPort === 3000 &&
      c.ingress.fqdn === target.fqdn,
    "ingress_changed",
  );
  check(
    t.containers.length === 1 && t.containers[0].image === target.oldImage,
    "rollback_image_changed",
  );
  check(
    JSON.stringify(c.ingress.traffic) === JSON.stringify(oldTraffic),
    "rollback_traffic_changed",
  );
  check(
    revision.name === target.oldRevision &&
      revision.properties.active === true &&
      revision.properties.healthState === "Healthy" &&
      revision.properties.runningState === "Running" &&
      revision.properties.template.containers[0].image === target.oldImage,
    "rollback_not_healthy",
  );
}

export function validateCandidate(before, after, image) {
  assert.deepEqual(
    after.properties.configuration,
    before.properties.configuration,
    "pr716_configuration_changed",
  );
  const normalized = (app) => {
    const template = structuredClone(app.properties.template);
    delete template.revisionSuffix;
    delete template.containers[0].image;
    return template;
  };
  assert.deepEqual(normalized(after), normalized(before), "pr716_template_changed");
  check(after.properties.template.containers[0].image === image, "candidate_image_mismatch");
}

export async function promote({ before, image, sha, az, readJson, readText, sleep }) {
  check(/^[a-f0-9]{40}$/.test(sha), "invalid_source");
  check(/^ghcr\.io\/blockigaming\/kovagpt-web@sha256:[a-f0-9]{64}$/.test(image), "invalid_image");
  const suffix = `pr716-${sha.slice(0, 7)}`;
  const revision = `${target.app}--${suffix}`;
  let updateStarted = false;
  try {
    updateStarted = true;
    az([
      "containerapp",
      "update",
      ...select,
      "--image",
      image,
      "--revision-suffix",
      suffix,
      "--no-wait",
    ]);
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(15000);
      const candidate = az(["containerapp", "revision", "show", ...select, "--revision", revision]);
      check(candidate.properties.template.containers[0].image === image, "revision_image_mismatch");
      if (
        candidate.properties.healthState === "Healthy" &&
        candidate.properties.runningState === "Running"
      ) {
        healthy = true;
        break;
      }
      check(candidate.properties.provisioningState !== "Failed", "revision_failed");
    }
    check(healthy, "readiness_timeout");
    validateCandidate(before, az(["containerapp", "show", ...select]), image);
    az([
      "containerapp",
      "ingress",
      "traffic",
      "set",
      ...select,
      "--revision-weight",
      `${revision}=100`,
    ]);
    let served = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(10000);
      if ((await readJson("/api/version")).sha === sha) {
        served = true;
        break;
      }
    }
    check(served && (await readJson("/api/health")).status === "ok", "live_health_failed");
    const pricing = await readText("/pricing");
    check(
      pricing.includes("Expanded dynamic chat usage") &&
        pricing.includes("Highest dynamic chat allowance") &&
        !/unlimited basic chat/i.test(pricing),
      "live_pricing_failed",
    );
    const after = az(["containerapp", "show", ...select]);
    assert.deepEqual(after.properties.configuration.ingress.traffic, [
      { revisionName: revision, weight: 100 },
    ]);
    return {
      sourceSha: sha,
      image,
      revision,
      trafficPercent: 100,
      health: "PASS",
      pricing: "PASS",
      rollbackRevision: target.oldRevision,
    };
  } catch (error) {
    if (updateStarted) {
      az([
        "containerapp",
        "ingress",
        "traffic",
        "set",
        ...select,
        "--revision-weight",
        `${target.oldRevision}=100`,
      ]);
      const revisions = az(["containerapp", "revision", "list", ...select]);
      if (revisions.some((r) => r.name === revision))
        az(["containerapp", "revision", "deactivate", ...select, "--revision", revision]);
    }
    throw error;
  }
}

function cliAz(args) {
  try {
    const output = execFileSync("az", [...args, "--only-show-errors", "--output", "json"], {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch {
    throw new Error("pr716_azure_operation_failed");
  }
}
async function get(path) {
  const response = await fetch(`${target.origin}${path}`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  check(response.ok, "public_request_failed");
  return response;
}
async function main() {
  const phase = process.argv[2];
  const beforePath = resolve(process.env.RUNNER_TEMP, "pr716-before.json");
  const account = cliAz(["account", "show"]);
  const app = cliAz(["containerapp", "show", ...select]);
  const rollback = cliAz([
    "containerapp",
    "revision",
    "show",
    ...select,
    "--revision",
    target.oldRevision,
  ]);
  validateBefore(account, app, rollback);
  check(
    (await (await get("/api/version")).json()).sha === target.oldSha,
    "live_rollback_source_changed",
  );
  if (phase === "preflight") {
    writeFileSync(beforePath, JSON.stringify(app), { mode: 0o600 });
    console.log("PR716_PREFLIGHT=PASS");
    return;
  }
  check(phase === "deploy", "invalid_phase");
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  assert.deepEqual(
    app.properties.configuration,
    before.properties.configuration,
    "pr716_preflight_stale",
  );
  assert.deepEqual(app.properties.template, before.properties.template, "pr716_preflight_stale");
  const image = readFileSync(
    resolve(process.env.RUNNER_TEMP, "pr716-candidate/ghcr-candidate-image.txt"),
    "utf8",
  ).trim();
  const receipt = await promote({
    before,
    image,
    sha: process.env.GITHUB_SHA,
    az: cliAz,
    readJson: async (path) => (await get(path)).json(),
    readText: async (path) => (await get(path)).text(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  writeFileSync(
    resolve(process.env.RUNNER_TEMP, "pr716-release-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error("PR716_RELEASE=FAILED; inspect the failed step; no raw configuration was logged");
    process.exitCode = 1;
  });
