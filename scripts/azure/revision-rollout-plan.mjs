import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  reviewRevisionPreservation,
  reviewStagingRevisionPreservation,
} from "./revision-preservation.mjs";

const API = "2025-01-01";
const HASH = /^[a-f0-9]{64}$/u;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const require = (ok, code) => {
  if (!ok) throw new Error(`revision_rollout_${code}`);
};
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, canonical(v[key])]),
        )
      : v;
export const documentSha256 = (v) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const time = (v) =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(v)
    ? Date.parse(v)
    : NaN;

function validateCompleteCapture(input) {
  const { baseline: b, previousRevision: previous, inventory } = input;
  require(object(b) && object(previous) && object(inventory), "capture_required");
  require(inventory.complete === true &&
    inventory.apiVersion === API &&
    HASH.test(inventory.receiptSha256 ?? "") &&
    Number.isFinite(time(inventory.observedAt)), "capture_binding_required");
  require(inventory.baselineSha256 === documentSha256(b) &&
    inventory.previousRevisionSha256 === documentSha256(previous), "capture_hash_mismatch");
  require(typeof b.location === "string" &&
    b.location.length > 0 &&
    object(b.tags) &&
    object(b.identity) &&
    ["UserAssigned", "SystemAssigned", "SystemAssigned, UserAssigned"].includes(
      b.identity.type,
    ), "complete_resource_required");
  if (b.identity.type.includes("UserAssigned"))
    require(object(b.identity.userAssignedIdentities) &&
      Object.keys(b.identity.userAssignedIdentities).length > 0, "identity_incomplete");
  const configuration = b.properties?.configuration;
  const template = b.properties?.template;
  require(object(configuration) &&
    object(template) &&
    Array.isArray(configuration.secrets) &&
    Array.isArray(configuration.registries) &&
    Array.isArray(template.containers) &&
    template.containers.length > 0, "complete_configuration_required");
  require(configuration.ingress?.allowInsecure === false &&
    typeof configuration.ingress.external === "boolean" &&
    Array.isArray(configuration.ingress.customDomains) &&
    Array.isArray(configuration.ingress.ipSecurityRestrictions) &&
    typeof configuration.ingress.clientCertificateMode ===
      "string", "complete_origin_controls_required");
  require(b.properties.provisioningState === "Succeeded" &&
    Number.isInteger(previous.properties?.replicas) &&
    previous.properties.replicas > 0, "healthy_previous_replica_required");
  const primary = template.containers.find((c) => c.name === input.scope?.containerName);
  require(Array.isArray(primary?.probes) &&
    ["Readiness", "Liveness"].every((kind) =>
      primary.probes.some(
        (probe) =>
          probe.type === kind &&
          ((Number.isInteger(probe.httpGet?.port) &&
            probe.httpGet.port > 0 &&
            typeof probe.httpGet.path === "string") ||
            (Number.isInteger(probe.tcpSocket?.port) && probe.tcpSocket.port > 0)),
      ),
    ), "health_probes_required");
  require(template.containers.every(
    (c) =>
      Array.isArray(c.env) &&
      typeof c.resources?.cpu === "number" &&
      c.resources.cpu > 0 &&
      typeof c.resources.memory === "string" &&
      c.resources.memory.length > 0,
  ), "complete_container_resources_required");
  const names = new Set(configuration.secrets.map((s) => s.name));
  require(names.size === configuration.secrets.length, "duplicate_secret_reference");
  for (const secret of configuration.secrets) {
    require(typeof secret.name === "string" &&
      /^[a-z0-9-]+$/u.test(secret.name), "secret_inventory_incomplete");
    const inline = typeof secret.value === "string" && secret.value.length > 0;
    const reference =
      typeof secret.keyVaultUrl === "string" &&
      /^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[^/?#]+\/[^/?#]+$/iu.test(
        secret.keyVaultUrl,
      ) &&
      typeof secret.identity === "string" &&
      secret.identity.length > 0;
    require(inline !== reference, "secret_inventory_incomplete");
  }
  const checkReferences = (v) => {
    if (Array.isArray(v)) return v.forEach(checkReferences);
    if (!object(v)) return;
    for (const [key, value] of Object.entries(v)) {
      if (key === "secretRef" || key === "passwordSecretRef")
        require(names.has(value), "unresolved_secret_reference");
      else checkReferences(value);
    }
  };
  checkReferences(configuration);
  checkReferences(template);
  require(configuration.registries.some(
    (r) =>
      r.server === "kovagptacr-dte9hugbhjghcyb8.azurecr.io" &&
      ((typeof r.identity === "string" && r.identity.length > 0) || names.has(r.passwordSecretRef)),
  ), "registry_binding_required");
}

// Strip only response-only metadata, never writable configuration. Unknown
// nested configuration/template settings survive intact; unknown root fields
// fail closed rather than disappearing from a full-resource update.
function writableResource(document, environment) {
  const rootReadOnly = ["id", "name", "type", "systemData", "etag"];
  const rootWritable = [
    "location",
    "tags",
    "identity",
    "properties",
    "managedBy",
    "extendedLocation",
  ];
  require(Object.keys(document).every((key) =>
    [...rootReadOnly, ...rootWritable].includes(key),
  ), "unsupported_resource_field");
  const body = Object.fromEntries(
    rootWritable
      .filter((key) => Object.hasOwn(document, key))
      .map((key) => [key, structuredClone(document[key])]),
  );
  if (environment === "staging")
    require(!Object.hasOwn(body, "managedBy") &&
      !Object.hasOwn(body, "extendedLocation"), "staging_resource_extensions_require_review");
  const removed = rootReadOnly.filter((key) => Object.hasOwn(document, key));
  const remove = (value, key, path) => {
    if (Object.hasOwn(value, key)) {
      delete value[key];
      removed.push(path);
    }
  };
  for (const key of [
    "provisioningState",
    "runningStatus",
    "latestRevisionName",
    "latestReadyRevisionName",
    "latestRevisionFqdn",
    "customDomainVerificationId",
    "outboundIpAddresses",
    "eventStreamEndpoint",
  ])
    remove(body.properties, key, `properties.${key}`);
  remove(body.properties.configuration.ingress, "fqdn", "properties.configuration.ingress.fqdn");
  for (const key of ["principalId", "tenantId"]) remove(body.identity, key, `identity.${key}`);
  for (const [id, identity] of Object.entries(body.identity.userAssignedIdentities ?? {})) {
    require(object(identity), "identity_incomplete");
    for (const key of ["clientId", "principalId"]) {
      if (Object.hasOwn(identity, key)) {
        delete identity[key];
        removed.push(`identity.userAssignedIdentities[identity].${key}`);
      }
    }
    // The identity resource IDs themselves are unchanged.
    body.identity.userAssignedIdentities[id] = identity;
  }
  return { body, removed };
}

function deployment(document, environment, targetResourceId) {
  const { body, removed } = writableResource(document, environment);
  const targetResourceGroupId = targetResourceId.split(/\/providers\//iu)[0];
  // Private values remain secure-object parameter data, not interpolated ARM
  // expressions. In particular an env value beginning '[' stays literal.
  const resource = {
    condition: `[and(parameters('enableRevisionRollout'), equals(toLower(resourceGroup().id), '${targetResourceGroupId.toLowerCase()}'))]`,
    type: "Microsoft.App/containerApps",
    apiVersion: API,
    name: document.name,
    ...Object.fromEntries(
      Object.keys(body).map((key) => [key, `[parameters('rolloutResource').${key}]`]),
    ),
  };
  return {
    targetResourceId,
    targetResourceGroupId,
    clientTimeoutSeconds: 60,
    maximumAttempts: 1,
    retries: 0,
    requestBody: {
      properties: {
        mode: "Incremental",
        template: {
          $schema:
            "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
          contentVersion: "1.0.0.0",
          parameters: {
            enableRevisionRollout: { type: "bool", defaultValue: false },
            rolloutResource: { type: "secureObject" },
          },
          resources: [resource],
        },
        parameters: {
          enableRevisionRollout: { value: true },
          rolloutResource: { value: body },
        },
      },
    },
    omittedResponseOnlyPaths: removed,
  };
}

export function generateRevisionRolloutPlan(input, { now = new Date().toISOString() } = {}) {
  require(object(input) &&
    Object.keys(input).every((key) =>
      ["baseline", "previousRevision", "scope", "inventory", "canary", "desired"].includes(key),
    ), "input_contract_invalid");
  const { baseline, scope, canary, inventory } = input;
  require(scope?.environment === "production" ||
    scope?.environment === "staging", "environment_required");
  require(scope.rolloutOptIn === true, "explicit_opt_in_required");
  validateCompleteCapture(input);
  const start = time(canary?.windowStart),
    end = time(canary?.windowEnd),
    generated = time(now);
  require(Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(generated) &&
    generated <= start &&
    start < end &&
    end - start <= 3600000, "bounded_window_required");
  require(time(inventory.observedAt) <= generated &&
    generated - time(inventory.observedAt) <= 300000, "fresh_capture_required");
  require(start - time(inventory.observedAt) <= 300000, "capture_expires_before_window");
  require(Number.isInteger(canary.maximumCandidateWeight) &&
    canary.maximumCandidateWeight > 0 &&
    canary.maximumCandidateWeight < 100 &&
    Number.isInteger(canary.candidateWeight) &&
    canary.candidateWeight > 0 &&
    canary.candidateWeight <= canary.maximumCandidateWeight, "canary_weight_invalid");
  require(Number.isInteger(canary.maximumRecoveryMs) &&
    canary.maximumRecoveryMs > 0 &&
    canary.maximumRecoveryMs < end - start, "recovery_bound_required");
  const desired = structuredClone(baseline);
  desired.properties.configuration.activeRevisionsMode = "Multiple";
  desired.properties.configuration.ingress.traffic = [
    { revisionName: scope.previousRevision, weight: 100 },
  ];
  desired.properties.template.revisionSuffix = scope.candidateSuffix;
  const container = desired.properties.template.containers.find(
    (c) => c.name === scope.containerName,
  );
  require(container, "container_missing");
  container.image = scope.candidateImage;
  const review =
    scope.environment === "production"
      ? reviewRevisionPreservation
      : reviewStagingRevisionPreservation;
  const preservation = review({ ...input, desired });
  if (Object.hasOwn(input, "desired")) review(input);
  const weights = (candidateWeight) => [
    { revisionName: scope.previousRevision, weight: 100 - candidateWeight },
    { revisionName: preservation.candidateRevision, weight: candidateWeight },
  ];
  const prepare = structuredClone(baseline);
  prepare.properties.configuration.activeRevisionsMode = "Multiple";
  prepare.properties.configuration.ingress.traffic = [
    { revisionName: scope.previousRevision, weight: 100 },
  ];
  const withTraffic = (candidateWeight) => {
    const value = structuredClone(desired);
    value.properties.configuration.ingress.traffic = weights(candidateWeight);
    return value;
  };
  const step = (id, document, dependsOn, requiresEvidence) => {
    const request = deployment(document, scope.environment, scope.targetResourceId);
    const identity = documentSha256({
      sourceSha: scope.sourceSha,
      target: scope.targetResourceId,
      previousImage: scope.previousImage,
      candidateImage: scope.candidateImage,
      suffix: scope.candidateSuffix,
    });
    const deploymentName = `kova-${id}-${identity.slice(0, 16)}`;
    return {
      id,
      dependsOn,
      requiresEvidence,
      method: "PUT",
      deploymentName,
      url: `https://management.azure.com${request.targetResourceGroupId}/providers/Microsoft.Resources/deployments/${deploymentName}?api-version=2022-09-01`,
      ...request,
    };
  };
  return {
    schemaVersion: 1,
    kind: "offline-revision-rollout-plan",
    environment: scope.environment,
    sourceSha: scope.sourceSha,
    targetResourceId: scope.targetResourceId,
    generatedAt: now,
    inventory: structuredClone(inventory),
    preservation,
    previous: { revision: scope.previousRevision, image: scope.previousImage },
    candidate: { revision: preservation.candidateRevision, image: scope.candidateImage },
    initialTraffic: weights(0),
    canaryTraffic: weights(canary.candidateWeight),
    rollbackTraffic: weights(0),
    bounds: {
      ...structuredClone(canary),
      captureExpiresAt: new Date(time(inventory.observedAt) + 300000).toISOString(),
      rollbackMustStartBy: new Date(end - canary.maximumRecoveryMs).toISOString(),
      clientTimeoutSeconds: 60,
      retries: 0,
      maximumIncrementalSpendUsd: 0,
    },
    // Prepare Multiple mode before creating a candidate: creating it in Single
    // mode can deactivate the rollback revision. Do not reference a nonexistent
    // candidate in ingress until its creation has completed and been verified.
    steps: [
      step(
        "prepare-multiple",
        prepare,
        [],
        [
          "current exact full-property capture matches inventory",
          "previous remains active, running and healthy at pinned digest",
          "separate operation and zero-incremental-cost authorization",
        ],
      ),
      step(
        "create-candidate-zero-traffic",
        desired,
        ["prepare-multiple"],
        [
          "Multiple mode and named previous=100 verified; no competing writer",
          "candidate revision does not already exist; reconcile uncertain prior outcome",
        ],
      ),
      step(
        "pin-initial-traffic",
        withTraffic(0),
        ["create-candidate-zero-traffic"],
        [
          "candidate exists at pinned digest and is healthy through protected origin; previous remains healthy",
        ],
      ),
      step(
        "bounded-canary",
        withTraffic(canary.candidateWeight),
        ["pin-initial-traffic"],
        [
          "exact-source Auth and database backward compatibility accepted",
          "protected origin, edge and application smoke receipts PASS",
          "fresh property capture matches preceding step",
          "within approved window and rollback reserve",
        ],
      ),
      step(
        "rollback-traffic",
        withTraffic(0),
        ["pin-initial-traffic"],
        [
          "revalidate previous active/healthy/digest before traffic reversal",
          "run on canary failure or by rollbackMustStartBy; preserve both revisions",
          "reconcile latest configuration; stop rather than overwrite unrelated changes",
        ],
      ),
    ],
    stopConditions: [
      "any target, image, configuration or revision mismatch",
      "missing unhealthy or deactivated previous revision",
      "failed readiness, Auth, database, origin or edge check",
      "deadline, recovery reserve or approved cost limit reached",
      "unknown operation outcome: reconcile; never blind retry",
    ],
    requiredRollbackChecks: [
      "originLivez",
      "originReadyz",
      "originVersion",
      "edge",
      "auth",
      "databaseCompatibility",
    ],
    cleanup:
      "Preserve previous revision and both pinned images. Independently verify previous=100/candidate=0 and recovery timing. Candidate deactivation/retention requires the separately approved cleanup decision; no deletion or configuration reset is generated.",
    cloudRequestsMade: 0,
    executableByThisTool: false,
    authorizationGranted: false,
    liveAcceptanceEstablished: false,
    liveCostEntitlementEstablished: false,
  };
}

function readPrivateInput(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    require(stat.isFile() &&
      stat.size <= 4 * 1024 * 1024 &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(), "private_input_required");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    require(process.argv.length === 4, "private_paths_required");
    const input = readPrivateInput(process.argv[2]);
    const plan = generateRevisionRolloutPlan(input);
    const parent = lstatSync(dirname(resolve(process.argv[3])));
    require(parent.isDirectory() &&
      !parent.isSymbolicLink() &&
      (parent.mode & 0o077) === 0 &&
      parent.uid === process.getuid(), "private_output_directory_required");
    writeFileSync(process.argv[3], `${JSON.stringify(plan, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    console.log("REVISION_ROLLOUT_PLAN=PASS cloudRequests=0 liveAcceptance=false");
  } catch (error) {
    console.error(
      error instanceof Error && /^revision_(?:rollout|preservation)_[a-z_]+$/u.test(error.message)
        ? error.message
        : "revision_rollout_private_io_invalid",
    );
    process.exitCode = 1;
  }
}
