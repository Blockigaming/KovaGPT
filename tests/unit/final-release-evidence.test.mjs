import assert from "node:assert/strict";
import test from "node:test";

import { validateFinalReleaseEvidence } from "../../scripts/release/final-evidence.mjs";

const releaseSha = "a".repeat(40);
const allGates = Object.fromEntries(
  [
    "format",
    "lint",
    "typecheck",
    "unit",
    "api",
    "integration",
    "browserE2e",
    "accessibility",
    "visualRegression",
    "freshDatabase",
    "upgradeMigration",
    "twoUserRls",
    "security",
    "azureReadiness",
    "productionSmoke",
    "cloudflareRouting",
    "tls",
    "authentication",
    "billing",
    "scheduledWork",
    "observability",
    "healthChecks",
    "streaming",
    "toolCalling",
    "files",
    "images",
    "search",
    "research",
    "zeroLovableSource",
    "zeroLovableImage",
    "zeroLovableNetwork",
    "voiceAbsent",
    "rollbackExercised",
    "backupRecoveryReady",
  ].map((name) => [name, true]),
);

const valid = {
  schemaVersion: 1,
  releaseSha,
  ciSha: releaseSha,
  imageDigest: `sha256:${"b".repeat(64)}`,
  supabaseProjectRef: "mfbycmbjygcfkrsuepxf",
  browserSupabaseProjectRef: "mfbycmbjygcfkrsuepxf",
  serverSupabaseProjectRef: "mfbycmbjygcfkrsuepxf",
  primaryModel: "gpt-5.6-sol",
  requiredChecks: [{ name: "KovaGPT CI", status: "success", sha: releaseSha }],
  gates: allGates,
  knownP0: 0,
  knownP1: 0,
  productionRevision: "ca-kovagpt-prod--release",
  cloudflareOrigin: "ca-kovagpt-prod.example.azurecontainerapps.io",
};

test("100% completion requires exact-SHA production evidence for every final gate", () => {
  assert.deepEqual(validateFinalReleaseEvidence(valid), []);
  assert.ok(validateFinalReleaseEvidence({ ...valid, ciSha: "c".repeat(40) }).includes("ciSha"));
  assert.ok(
    validateFinalReleaseEvidence({
      ...valid,
      gates: { ...allGates, rollbackExercised: false },
    }).includes("gates.rollbackExercised"),
  );
  assert.ok(validateFinalReleaseEvidence({ ...valid, knownP1: 1 }).includes("knownP1"));
});
