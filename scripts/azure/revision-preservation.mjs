import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SHA = /^[a-f0-9]{40}$/u;
const IMAGE = /^kovagptacr-dte9hugbhjghcyb8\.azurecr\.io\/kovagpt-web@sha256:[a-f0-9]{64}$/u;
const TARGET =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/kovagpt-prod-web";
const fail = (code) => {
  throw new Error(`revision_preservation_${code}`);
};
const require = (condition, code) => {
  if (!condition) fail(code);
};

// Offline review of full private before/desired resource documents. This does
// not render an ARM request, call Azure, authorize a change, or establish that
// observations are current/authentic. Unknown properties are compared too.
export function reviewRevisionPreservation({ baseline, desired, scope, previousRevision }) {
  require(scope?.schemaVersion === 1 && SHA.test(scope.sourceSha ?? ""), "scope_invalid");
  require(scope.targetResourceId?.toLowerCase() === TARGET.toLowerCase(), "target_invalid");
  require(IMAGE.test(scope.previousImage ?? "") &&
    IMAGE.test(scope.candidateImage ?? "") &&
    scope.previousImage !== scope.candidateImage, "image_binding_invalid");
  require(/^[a-z][a-z0-9-]{0,62}$/u.test(scope.candidateSuffix ?? "") &&
    !scope.candidateSuffix.includes("--") &&
    !scope.candidateSuffix.endsWith("-"), "suffix_invalid");
  require(typeof scope.containerName === "string" &&
    /^[a-z][a-z0-9-]*$/u.test(scope.containerName), "container_invalid");
  require(typeof scope.previousRevision === "string" &&
    /^kovagpt-prod-web--[a-z][a-z0-9-]{0,62}$/u.test(scope.previousRevision) &&
    !scope.previousRevision.endsWith("-") &&
    scope.previousRevision !==
      `kovagpt-prod-web--${scope.candidateSuffix}`, "revision_binding_invalid");
  for (const document of [baseline, desired]) {
    require(document?.id?.toLowerCase() === TARGET.toLowerCase() &&
      document.name === "kovagpt-prod-web" &&
      document.type?.toLowerCase() === "microsoft.app/containerapps", "resource_binding_invalid");
    require(document.identity &&
      (document.properties?.environmentId || document.properties?.managedEnvironmentId) &&
      Array.isArray(document.properties.configuration?.secrets) &&
      Array.isArray(document.properties.template?.containers), "full_configuration_required");
  }
  const configuration = baseline.properties.configuration;
  const template = baseline.properties.template;
  require(baseline.properties.runningStatus === "Running" &&
    baseline.properties.latestReadyRevisionName ===
      scope.previousRevision, "serving_baseline_required");
  require(["Single", "Multiple"].includes(configuration.activeRevisionsMode) &&
    configuration.ingress &&
    Number.isInteger(configuration.ingress.targetPort) &&
    configuration.ingress.targetPort > 0, "serving_ingress_required");
  require(Array.isArray(configuration.ingress.traffic) &&
    configuration.ingress.traffic.length === 1, "unambiguous_baseline_traffic_required");
  const beforeWeight = configuration.ingress.traffic[0];
  require(beforeWeight.weight === 100 &&
    !beforeWeight.label &&
    ((beforeWeight.revisionName === scope.previousRevision &&
      beforeWeight.latestRevision !== true) ||
      (configuration.activeRevisionsMode === "Single" &&
        beforeWeight.latestRevision === true &&
        !beforeWeight.revisionName)), "baseline_traffic_binding_invalid");
  require(template.scale &&
    Number.isInteger(template.scale.minReplicas) &&
    template.scale.minReplicas >= 0 &&
    Number.isInteger(template.scale.maxReplicas) &&
    template.scale.maxReplicas > 0 &&
    template.scale.minReplicas <= template.scale.maxReplicas, "scale_required");
  const containers = template.containers;
  require(containers.length > 0 &&
    new Set(containers.map((c) => c.name)).size === containers.length &&
    containers.every((c) => Array.isArray(c.env) && c.resources), "complete_containers_required");
  const index = containers.findIndex((c) => c.name === scope.containerName);
  require(index >= 0 && containers[index].image === scope.previousImage, "previous_image_mismatch");
  require(previousRevision?.id?.toLowerCase() ===
    `${TARGET}/revisions/${scope.previousRevision}`.toLowerCase() &&
    previousRevision.name === scope.previousRevision &&
    previousRevision.properties?.active === true &&
    previousRevision.properties.healthState === "Healthy" &&
    previousRevision.properties.runningState === "Running" &&
    isDeepStrictEqual(
      previousRevision.properties.template,
      template,
    ), "previous_revision_unverified");

  // Exactly four permitted paths; preserve every other setting, secret value /
  // reference, identity, sidecar, volume, probe, scale rule, tag and origin control.
  const expected = structuredClone(baseline);
  expected.properties.configuration.activeRevisionsMode = "Multiple";
  expected.properties.configuration.ingress.traffic = [
    { revisionName: scope.previousRevision, weight: 100 },
  ];
  expected.properties.template.revisionSuffix = scope.candidateSuffix;
  expected.properties.template.containers[index].image = scope.candidateImage;
  require(isDeepStrictEqual(desired, expected), "unapproved_property_change");

  return {
    kind: "offline-production-revision-preservation-review",
    result: "PASS",
    sourceSha: scope.sourceSha,
    targetResourceId: TARGET,
    candidateRevision: `kovagpt-prod-web--${scope.candidateSuffix}`,
    candidateImage: scope.candidateImage,
    previousRevision: scope.previousRevision,
    previousImage: scope.previousImage,
    configurationPreserved: true,
    initialCandidateTrafficPercent: 0,
    previousTrafficPercent: 100,
    changedPathsAllowlist: [
      "properties.configuration.activeRevisionsMode",
      "properties.configuration.ingress.traffic",
      "properties.template.revisionSuffix",
      "properties.template.containers[approved-container].image",
    ],
    rollbackTraffic: [
      { revisionName: scope.previousRevision, weight: 100 },
      { revisionName: `kovagpt-prod-web--${scope.candidateSuffix}`, weight: 0 },
    ],
    rollbackExercised: false,
    authorizationGranted: false,
    deploymentReady: false,
    liveEvidenceStillRequired: true,
    incrementalCandidateCostEstablished: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    require(process.argv.length === 3, "private_input_required");
    const file = process.argv[2];
    const stat = lstatSync(file);
    require(stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size <= 4 * 1024 * 1024 &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(), "private_input_required");
    const report = reviewRevisionPreservation(JSON.parse(readFileSync(file, "utf8")));
    // Fixed allowlisted result only. Never print the input or property values.
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code =
      error instanceof Error && /^revision_preservation_[a-z_]+$/u.test(error.message)
        ? error.message
        : "revision_preservation_private_input_invalid";
    console.error(code);
    process.exitCode = 1;
  }
}
