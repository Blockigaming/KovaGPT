import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  promote,
  target,
  validateBefore,
  validateCandidate,
} from "../../scripts/azure/release-pr716-once.mjs";

const sha = "a".repeat(40);
const image = `ghcr.io/blockigaming/kovagpt-web@sha256:${"b".repeat(64)}`;
const revisionName = `${target.app}--pr716-${sha.slice(0, 7)}`;
function fixture() {
  const account = { id: target.subscription, tenantId: target.tenant };
  const before = {
    name: target.app,
    id: `/subscriptions/${target.subscription}/resourceGroups/${target.group}/providers/Microsoft.App/containerApps/${target.app}`,
    properties: {
      configuration: {
        activeRevisionsMode: "Multiple",
        ingress: {
          external: true,
          allowInsecure: false,
          targetPort: 3000,
          fqdn: target.fqdn,
          traffic: [{ revisionName: target.oldRevision, weight: 100 }],
        },
      },
      template: {
        revisionSuffix: "old",
        containers: [
          { image: target.oldImage, env: [{ name: "API_KEY", secretRef: "existing-reference" }] },
        ],
        scale: { minReplicas: 1, maxReplicas: 4 },
      },
    },
  };
  const rollback = {
    name: target.oldRevision,
    properties: {
      active: true,
      healthState: "Healthy",
      runningState: "Running",
      template: structuredClone(before.properties.template),
    },
  };
  return { account, before, rollback };
}
test("release refuses a changed account, app, rollback image, traffic or readiness", () => {
  const f = fixture();
  validateBefore(f.account, f.before, f.rollback);
  for (const change of [
    (v) => (v.account.id = "different"),
    (v) => (v.before.name = "different"),
    (v) => (v.before.properties.template.containers[0].image = image),
    (v) => (v.before.properties.configuration.ingress.traffic[0].weight = 50),
    (v) => (v.before.properties.configuration.ingress.allowInsecure = true),
    (v) => (v.rollback.properties.healthState = "Unhealthy"),
  ]) {
    const altered = structuredClone(f);
    change(altered);
    assert.throws(() => validateBefore(altered.account, altered.before, altered.rollback));
  }
});
test("candidate may change only image and revision suffix, preserving secrets, ingress and scaling", () => {
  const { before } = fixture();
  const after = structuredClone(before);
  after.properties.template.containers[0].image = image;
  after.properties.template.revisionSuffix = "candidate";
  validateCandidate(before, after, image);
  after.properties.template.containers[0].env[0].secretRef = "different";
  assert.throws(() => validateCandidate(before, after, image));
});
function runtime(failPricing = false) {
  const { before } = fixture();
  const current = structuredClone(before);
  const calls = [];
  const az = (args) => {
    calls.push(args);
    if (args[1] === "update") {
      current.properties.template.containers[0].image = image;
      current.properties.template.revisionSuffix = "candidate";
      return null;
    }
    if (args[1] === "revision" && args[2] === "show")
      return {
        properties: {
          healthState: "Healthy",
          runningState: "Running",
          template: current.properties.template,
        },
      };
    if (args[1] === "ingress") {
      current.properties.configuration.ingress.traffic = [
        { revisionName: args.at(-1).split("=")[0], weight: 100 },
      ];
      return null;
    }
    if (args[1] === "show") return structuredClone(current);
    if (args[1] === "revision" && args[2] === "list")
      return [{ name: target.oldRevision }, { name: revisionName }];
    if (args[1] === "revision" && args[2] === "deactivate") return null;
    throw new Error("Unexpected Azure operation");
  };
  return {
    calls,
    current,
    input: {
      before,
      image,
      sha,
      az,
      sleep: async () => {},
      readJson: async (path) => (path === "/api/version" ? { sha } : { status: "ok" }),
      readText: async () =>
        failPricing ? "old copy" : "Expanded dynamic chat usage Highest dynamic chat allowance",
    },
  };
}
test("healthy exact image is promoted with a sanitized receipt and preserved rollback", async () => {
  const f = runtime();
  const result = await promote(f.input);
  assert.equal(result.sourceSha, sha);
  assert.equal(result.trafficPercent, 100);
  assert.equal(result.rollbackRevision, target.oldRevision);
  assert.equal(
    f.calls.some((args) => args.includes("deactivate")),
    false,
  );
  assert.equal(JSON.stringify(result).includes("existing-reference"), false);
});
test("failed live acceptance restores old traffic and deactivates only this candidate", async () => {
  const f = runtime(true);
  await assert.rejects(promote(f.input), /live_pricing_failed/);
  assert.deepEqual(f.current.properties.configuration.ingress.traffic, [
    { revisionName: target.oldRevision, weight: 100 },
  ]);
  const deactivation = f.calls.find((args) => args.includes("deactivate"));
  assert.equal(deactivation.at(-1), revisionName);
});
test("unqualified image and source cannot cause any Azure write", async () => {
  const f = runtime();
  await assert.rejects(promote({ ...f.input, image: "mutable:latest" }));
  assert.equal(f.calls.length, 0);
});
test("one-time build is main-only, respects Reader authority and pins the reviewed application tree", () => {
  const workflow = readFileSync(".github/workflows/release-pr716-once.yml", "utf8");
  assert.match(workflow, /github.event_name == 'push'.*github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /git diff --exit-code 4f6ef7516a52ec0a197ebaa94c0eb2595a606826 HEAD/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /source_sha="\$GITHUB_SHA"/);
  assert.match(workflow, /release-pr716-once\.mjs preflight/);
  assert.match(workflow, /pr716-production-candidate/);
  assert.doesNotMatch(workflow, /release-pr716-once\.mjs deploy/);
  assert.doesNotMatch(
    workflow,
    /role assignment create|containerapp up|deployment group create|pull_request_target/,
  );
});
