import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateRollbackEvidence } from "./rollback-evidence.mjs";

// Source-only consistency check for the existing M19 contract. This does not
// establish collector authenticity, authorize traffic, or award acceptance.
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE =
  /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[\w.-]+\/providers\/Microsoft\.App\/containerapps\/[a-z0-9-]+$/iu;
const CHECKS = [
  "originLivez",
  "originReadyz",
  "originVersion",
  "edge",
  "auth",
  "databaseCompatibility",
];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value) =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value)
    ? Date.parse(value)
    : NaN;
const isText = (value) =>
  typeof value === "string" && value.trim().length > 0 && !/REPLACE_WITH/iu.test(value);

export function validateAzureRollbackExercise(evidence, approvedScope) {
  const errors = [];
  const require = (condition, code) => {
    if (!condition) errors.push(code);
  };
  if (!isObject(evidence) || !isObject(approvedScope)) return ["evidenceAndApprovedScopeRequired"];
  errors.push(...validateRollbackEvidence(evidence).map((code) => `structure.${code}`));
  require(evidence.schemaVersion === 1 && approvedScope.schemaVersion === 1, "schemaVersion");
  require(evidence.kind === "actual-azure-revision-rollback", "actualExerciseRequired");
  require(approvedScope.milestone === "M19", "scope.milestone");
  require(typeof approvedScope.targetResourceId === "string" &&
    RESOURCE.test(approvedScope.targetResourceId), "scope.targetResourceId");
  require(evidence.targetResourceId === approvedScope.targetResourceId, "targetBinding");
  require(typeof approvedScope.authorizationSha256 === "string" &&
    SHA256.test(approvedScope.authorizationSha256), "scope.authorizationSha256");
  require(evidence.authorizationSha256 ===
    approvedScope.authorizationSha256, "authorizationBinding");
  require(approvedScope.maximumIncrementalSpendUsd === 0 &&
    evidence.incrementalSpendUsd === 0, "zeroCostBoundary");
  require(Number.isInteger(approvedScope.maximumCandidateWeight) &&
    approvedScope.maximumCandidateWeight > 0 &&
    approvedScope.maximumCandidateWeight <= 100, "scope.maximumCandidateWeight");
  require(Number.isInteger(approvedScope.maximumRecoveryMs) &&
    approvedScope.maximumRecoveryMs > 0, "scope.maximumRecoveryMs");

  for (const identity of ["candidate", "previous"]) {
    const pin = approvedScope[identity];
    require(isObject(pin), `scope.${identity}`);
    require(isText(pin?.revision), `scope.${identity}.revision`);
    require(typeof pin?.imageDigest === "string" &&
      DIGEST.test(pin.imageDigest), `scope.${identity}.imageDigest`);
    require(typeof pin?.releaseSha === "string" &&
      SHA.test(pin.releaseSha), `scope.${identity}.releaseSha`);
    require(evidence[`${identity}Revision`] === pin?.revision, `${identity}.revisionBinding`);
    require(evidence[`${identity}ImageDigest`] === pin?.imageDigest, `${identity}.imageBinding`);
  }
  require(approvedScope.candidate?.revision !==
    approvedScope.previous?.revision, "distinctRevisions");
  require(evidence.releaseSha === approvedScope.candidate?.releaseSha, "releaseBinding");
  require(isText(approvedScope.backupReference) &&
    evidence.backupReference === approvedScope.backupReference, "backupBinding");

  const windowStart = timestamp(approvedScope.windowStart);
  const windowEnd = timestamp(approvedScope.windowEnd);
  const started = timestamp(evidence.rollback?.startedAt);
  const completed = timestamp(evidence.rollback?.completedAt);
  require(Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    windowStart < windowEnd, "scope.window");
  require(windowStart <= started &&
    started <= completed &&
    completed <= windowEnd, "rollback.window");
  require(evidence.rollback?.exitCode === 0 &&
    evidence.rollback?.operation === "revision-traffic-rollback", "rollback.success");
  require(typeof evidence.rollback?.receiptSha256 === "string" &&
    SHA256.test(evidence.rollback.receiptSha256), "rollback.receipt");

  let finalCheck = completed;
  for (const [phase, identity] of [
    ["before", "candidate"],
    ["after", "previous"],
  ]) {
    const snapshot = evidence[phase];
    const pin = approvedScope[identity];
    const observed = timestamp(snapshot?.observedAt);
    require(snapshot?.revisionMode === "Multiple", `${phase}.multipleRevisionMode`);
    require(snapshot?.targetResourceId ===
      approvedScope.targetResourceId, `${phase}.targetBinding`);
    require(typeof snapshot?.receiptSha256 === "string" &&
      SHA256.test(snapshot.receiptSha256), `${phase}.receipt`);
    require(phase === "before"
      ? windowStart <= observed && observed <= started
      : completed <= observed && observed <= windowEnd, `${phase}.observationWindow`);
    const weights = Array.isArray(snapshot?.weights) ? snapshot.weights : [];
    require(weights.length === 2, `${phase}.twoRevisionWeights`);
    for (const name of ["candidate", "previous"]) {
      const bound = approvedScope[name];
      const matching = weights.filter(
        (entry) => isObject(entry) && entry.revision === bound?.revision,
      );
      require(matching.length === 1, `${phase}.${name}.uniqueRevision`);
      const row = matching[0];
      require(row?.imageDigest === bound?.imageDigest, `${phase}.${name}.imageBinding`);
      require(Number.isInteger(row?.weight) &&
        row.weight >= 0 &&
        row.weight <= 100, `${phase}.${name}.weight`);
    }
    const candidate = weights.find(
      (row) => row?.revision === approvedScope.candidate?.revision,
    )?.weight;
    const previous = weights.find(
      (row) => row?.revision === approvedScope.previous?.revision,
    )?.weight;
    require(candidate + previous === 100, `${phase}.weightTotal`);
    require(phase === "before"
      ? candidate > 0 && candidate <= approvedScope.maximumCandidateWeight
      : candidate === 0 && previous === 100, `${phase}.measuredTransition`);
    for (const name of CHECKS) {
      const check = snapshot?.checks?.[name];
      const checked = timestamp(check?.observedAt);
      require(check?.status === "PASS", `${phase}.${name}.status`);
      require(typeof check?.receiptSha256 === "string" &&
        SHA256.test(check.receiptSha256), `${phase}.${name}.receipt`);
      require(check?.revision === pin?.revision &&
        check?.imageDigest === pin?.imageDigest &&
        check?.releaseSha === pin?.releaseSha, `${phase}.${name}.identity`);
      require(observed <= checked &&
        checked <= (phase === "before" ? started : windowEnd), `${phase}.${name}.window`);
      if (name.startsWith("origin"))
        require(check?.authenticatedOrigin === true, `${phase}.${name}.protectedOrigin`);
      if (phase === "after") finalCheck = Math.max(finalCheck, checked);
    }
  }
  const recoveryMs = finalCheck - started;
  require(Number.isFinite(recoveryMs) &&
    recoveryMs > 0 &&
    recoveryMs <= approvedScope.maximumRecoveryMs &&
    evidence.observedRecoveryMs === recoveryMs, "measuredRecoveryTime");
  require(evidence.databaseWrites === 0 &&
    evidence.authMigrationPerformed === false, "noUnapprovedDataMutation");
  return [...new Set(errors)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("input");
    const inputs = process.argv.slice(2).map((file) => {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("input");
      return JSON.parse(readFileSync(file, "utf8"));
    });
    const errors = validateAzureRollbackExercise(...inputs);
    if (errors.length) {
      console.error(`M19_EVIDENCE_CONSISTENCY=FAIL gates=${errors.join(",")}`);
      process.exitCode = 1;
    } else {
      console.log(
        "M19_EVIDENCE_CONSISTENCY=PASS independentAcceptanceStillRequired=true authorizationNotGranted=true",
      );
    }
  } catch {
    // Do not echo JSON parse messages, paths, or input values from private files.
    console.error("M19_EVIDENCE_CONSISTENCY=FAIL gates=unreadableOrMalformedInput");
    process.exitCode = 1;
  }
}
