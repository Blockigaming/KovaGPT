import { documentSha256 } from "../../scripts/azure/revision-rollout-plan.mjs";

export function bindCapture(input) {
  input.inventory.baselineSha256 = documentSha256(input.baseline);
  input.inventory.previousRevisionSha256 = documentSha256(input.previousRevision);
  return input;
}

export function rolloutFixture(environment = "production", now = "2026-10-12T18:00:00.000Z") {
  const subscription = "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4";
  const group = `${subscription}/resourceGroups/rg-kovagpt-${environment === "production" ? "prod" : "staging"}`;
  const name = environment === "production" ? "kovagpt-prod-web" : "ca-kovagpt-staging";
  const target = `${group}/providers/Microsoft.App/containerApps/${name}`;
  const identity = `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/synthetic`;
  const image = (char) =>
    `kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web@sha256:${char.repeat(64)}`;
  const scope = {
    schemaVersion: 1,
    environment,
    rolloutOptIn: true,
    ...(environment === "staging" ? { stagingRolloutOptIn: true } : {}),
    sourceSha: "a".repeat(40),
    targetResourceId: target,
    containerName: "web",
    previousRevision: `${name}--previous`,
    candidateSuffix: "candidate",
    previousImage: image("b"),
    candidateImage: image("c"),
  };
  const baseline = {
    id: target,
    name,
    type: "Microsoft.App/containerApps",
    location: "eastus",
    tags: { synthetic: "true" },
    systemData: { createdByType: "Application" },
    identity: {
      type: "UserAssigned",
      userAssignedIdentities: {
        [identity]: { clientId: "synthetic-read-only", principalId: "synthetic-read-only" },
      },
    },
    properties: {
      managedEnvironmentId: `${group}/providers/Microsoft.App/managedEnvironments/synthetic`,
      provisioningState: "Succeeded",
      runningStatus: "Running",
      latestReadyRevisionName: scope.previousRevision,
      latestRevisionName: scope.previousRevision,
      configuration: {
        activeRevisionsMode: "Single",
        secrets: [
          {
            name: "synthetic-auth",
            keyVaultUrl: "https://synthetic.vault.azure.net/secrets/auth/version1",
            identity,
          },
        ],
        registries: [{ server: "kovagptacr-dte9hugbhjghcyb8.azurecr.io", identity }],
        ingress: {
          external: true,
          targetPort: 3000,
          allowInsecure: false,
          clientCertificateMode: "require",
          fqdn: "synthetic.example.invalid",
          customDomains: [],
          ipSecurityRestrictions: [
            { name: "synthetic", action: "Allow", ipAddressRange: "192.0.2.0/24" },
          ],
          corsPolicy: { allowedOrigins: ["https://example.invalid"] },
          traffic: [{ latestRevision: true, weight: 100 }],
        },
        futureConfiguration: { preserve: "SYNTHETIC_PRIVATE_MARKER" },
      },
      template: {
        revisionSuffix: "previous",
        scale: {
          minReplicas: 1,
          maxReplicas: 4,
          rules: [{ name: "http", http: { metadata: { concurrentRequests: "20" } } }],
        },
        containers: [
          {
            name: "web",
            image: scope.previousImage,
            resources: { cpu: 0.5, memory: "1Gi" },
            env: [
              { name: "KOVA_AUTH_SECRET", secretRef: "synthetic-auth" },
              { name: "OPAQUE", value: "[literal-not-an-ARM-expression]" },
              { name: "AI_GENERATION_ENABLED", value: "false" },
            ],
            probes: ["Readiness", "Liveness"].map((type) => ({
              type,
              tcpSocket: { port: 3000 },
              periodSeconds: 10,
            })),
            volumeMounts: [{ volumeName: "scratch", mountPath: "/scratch" }],
          },
          {
            name: "sidecar",
            image: image("d"),
            resources: { cpu: 0.25, memory: "0.5Gi" },
            env: [],
          },
        ],
        initContainers: [
          { name: "init", image: image("e"), env: [], resources: { cpu: 0.25, memory: "0.5Gi" } },
        ],
        volumes: [{ name: "scratch", storageType: "EmptyDir" }],
        futureTemplate: { preserve: true },
      },
      workloadProfileName: "Consumption",
      futureProperty: { preserve: true },
    },
  };
  const previousRevision = {
    id: `${target}/revisions/${scope.previousRevision}`,
    name: scope.previousRevision,
    properties: {
      active: true,
      healthState: "Healthy",
      runningState: "Running",
      replicas: 1,
      template: structuredClone(baseline.properties.template),
    },
  };
  return bindCapture({
    baseline,
    previousRevision,
    scope,
    inventory: {
      complete: true,
      apiVersion: "2025-01-01",
      observedAt: now,
      receiptSha256: "f".repeat(64),
    },
    canary: {
      windowStart: new Date(Date.parse(now) + 30000).toISOString(),
      windowEnd: new Date(Date.parse(now) + 630000).toISOString(),
      maximumCandidateWeight: 5,
      candidateWeight: 5,
      maximumRecoveryMs: 60000,
    },
  });
}
