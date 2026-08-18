import { readFileSync } from "node:fs";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;

function requireTrue(value, name, errors) {
  if (value !== true) errors.push(name);
}

export function validateFinalReleaseEvidence(value) {
  const errors = [];
  if (value?.schemaVersion !== 1) errors.push("schemaVersion");
  if (!SHA.test(value?.releaseSha ?? "")) errors.push("releaseSha");
  if (value?.ciSha !== value?.releaseSha) errors.push("ciSha");
  if (!DIGEST.test(value?.imageDigest ?? "")) errors.push("imageDigest");
  if (!PROJECT_REF.test(value?.supabaseProjectRef ?? "")) errors.push("supabaseProjectRef");
  if (value?.browserSupabaseProjectRef !== value?.supabaseProjectRef) {
    errors.push("browserSupabaseProjectRef");
  }
  if (value?.serverSupabaseProjectRef !== value?.supabaseProjectRef) {
    errors.push("serverSupabaseProjectRef");
  }
  if (value?.primaryModel !== "gpt-5.6-sol") errors.push("primaryModel");
  if (!Array.isArray(value?.requiredChecks) || value.requiredChecks.length === 0) {
    errors.push("requiredChecks");
  } else if (
    value.requiredChecks.some(
      (check) => check?.status !== "success" || check?.sha !== value.releaseSha,
    )
  ) {
    errors.push("requiredChecksExactSha");
  }

  for (const name of [
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
  ]) {
    requireTrue(value?.gates?.[name], `gates.${name}`, errors);
  }

  if (value?.knownP0 !== 0) errors.push("knownP0");
  if (value?.knownP1 !== 0) errors.push("knownP1");
  if (typeof value?.productionRevision !== "string" || !value.productionRevision.trim()) {
    errors.push("productionRevision");
  }
  if (typeof value?.cloudflareOrigin !== "string" || !value.cloudflareOrigin.trim()) {
    errors.push("cloudflareOrigin");
  }
  return [...new Set(errors)].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.env.KOVA_FINAL_EVIDENCE_FILE ?? process.argv[2];
  if (!path) throw new Error("final_release_evidence_file_required");
  const errors = validateFinalReleaseEvidence(JSON.parse(readFileSync(path, "utf8")));
  if (errors.length) throw new Error(`final_release_evidence_incomplete:${errors.join(",")}`);
  console.log("KOVAGPT_FINALIZED_GOAL=100_PERCENT_VERIFIED");
}
