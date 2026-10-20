import assert from "node:assert/strict";
import test from "node:test";
import {
  qualifyGenerationStaging,
  generationConfigurationDigest,
} from "../../scripts/azure/qualify-generation-staging.mjs";
import { createAcceptanceFixture } from "../helpers/generation-acceptance.mjs";

const sha = "a".repeat(40),
  tree = "b".repeat(40),
  hex = "c".repeat(64);
const image = `fixture.azurecr.io/kova@sha256:${hex}`;
const now = Date.UTC(2026, 9, 20, 1);
function fixture() {
  const env = Object.entries({
    AZURE_ENVIRONMENT: "staging",
    KOVA_AUTH_MODE: "supabase",
    KOVA_GENERATION_DISABLED: "false",
    AI_GENERATION_ENABLED: "true",
    KOVA_SPEECH_ENABLED: "true",
    KOVA_GENERATION_ACCEPTANCE_ENABLED: "true",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    KOVA_SOURCE_TREE: tree,
    KOVA_IMAGE_DIGEST: `sha256:${hex}`,
    CONTAINER_APP_REVISION: "ca-kovagpt-staging--fixture",
    KOVA_TEXT_PROVIDER: "openai",
    KOVA_INSTANT_MODEL: "gpt-5.6-luna",
    KOVA_MODEL_DEFAULT_CHAT: "gpt-5.6-luna",
    ELEVENLABS_VOICE_ID: "fixtureVoice",
    KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256: hex,
    KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256: hex,
  }).map(([name, value]) => ({ name, value }));
  const names = [
    "OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
    "KOVA_IP_HASH_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  env.push(...names.map((name) => ({ name, secretRef: name.toLowerCase() })));
  const result = {
    sourceSha: sha,
    sourceTree: tree,
    collectedAt: new Date(now).toISOString(),
    imageReference: image,
    registryManifestDigest: `sha256:${hex}`,
    image: {
      Id: `sha256:${"d".repeat(64)}`,
      RepoDigests: [image],
      Os: "linux",
      Architecture: "amd64",
      Config: {
        User: "kova",
        Labels: {
          "org.opencontainers.image.revision": sha,
          "com.kovagpt.source.tree": tree,
          "com.kovagpt.browser.config-verified": "true",
        },
      },
    },
    browserProvenance: {
      verification: "verified-build-time-browser-config",
      sourceContext: "git-archive",
      sourceSha: sha,
      sourceTree: tree,
      browserBundleSha256: hex,
      authMode: "supabase",
    },
    publicOrigin: "https://fixture.azurecontainerapps.io",
    app: {
      name: "ca-kovagpt-staging",
      id: "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-kovagpt-staging/providers/Microsoft.App/containerApps/ca-kovagpt-staging",
      properties: {
        latestRevisionName: "ca-kovagpt-staging--fixture",
        configuration: {
          ingress: { allowInsecure: false, fqdn: "fixture.azurecontainerapps.io" },
          secrets: names.map((name) => ({ name: name.toLowerCase() })),
        },
        template: {
          containers: [{ image, env, resources: { cpu: 0.5, memory: "1Gi" } }],
          scale: { minReplicas: 0, maxReplicas: 1 },
        },
      },
    },
    revisions: [
      {
        name: "ca-kovagpt-staging--fixture",
        active: true,
        traffic: 100,
        image,
        healthState: "Healthy",
      },
    ],
    version: {
      sha,
      revision: "ca-kovagpt-staging--fixture",
      origin: "https://fixture.azurecontainerapps.io",
    },
    providerBindings: {
      textProvider: "openai",
      modelId: "gpt-5.6-luna",
      voiceId: "fixtureVoice",
      speechModelId: "eleven_multilingual_v2",
      privateUsabilityEvidenceSha256: hex,
      voiceAndEntitlementEvidenceSha256: hex,
      exactPricingEvidenceSha256: hex,
    },
    acceptancePlanSha256: hex,
    generationApprovalReceiptSha256: hex,
    ci: { sourceSha: sha, sourceTree: tree, requiredChecksPassed: true, evidenceSha256: hex },
  };
  const a = createAcceptanceFixture({ now });
  a.plan.target.commit = sha;
  a.plan.target.tree = tree;
  a.plan.target.imageDigest = `sha256:${hex}`;
  a.plan.target.configurationEvidenceSha256 = generationConfigurationDigest(result);
  a.plan.quote.pricingEvidenceSha256 = hex;
  a.bind();
  result.acceptancePlanSha256 = a.config.expectedPlanSha256;
  result.generationApprovalReceiptSha256 = a.config.expectedApprovalReceiptSha256;
  for (const [name, value] of Object.entries({
    KOVA_GENERATION_ACCEPTANCE_PLAN: JSON.stringify(a.plan),
    KOVA_GENERATION_ACCEPTANCE_APPROVAL: JSON.stringify(a.config.approvalReceipt),
    KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256: result.acceptancePlanSha256,
    KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256: result.generationApprovalReceiptSha256,
  })) {
    const entry = env.find((e) => e.name === name);
    if (entry) entry.value = value;
    else env.push({ name, value });
  }
  return result;
}
const check = (e) => qualifyGenerationStaging(e, { sourceSha: sha, sourceTree: tree, now });
test("synthetic exact image/source/revision/provider bindings validate without conferring authority", () => {
  assert.equal(check(fixture()).status, "EVIDENCE_BINDINGS_VALID_NO_EXECUTION_AUTHORITY_GRANTED");
});
for (const [name, change] of Object.entries({
  "old source": (e) => {
    e.sourceSha = "e".repeat(40);
  },
  "mutable image": (e) => {
    e.imageReference = "fixture.azurecr.io/kova:latest";
  },
  "config digest substituted for manifest": (e) => {
    e.registryManifestDigest = e.image.Id;
  },
  "unverified browser": (e) => {
    e.browserProvenance.authMode = "dual";
  },
  "wrong image labels": (e) => {
    e.image.Config.Labels["com.kovagpt.source.tree"] = sha;
  },
  "different serving revision image": (e) => {
    e.revisions[0].image = "other";
  },
  "unhealthy revision": (e) => {
    e.revisions[0].healthState = "Unhealthy";
  },
  "two replicas": (e) => {
    e.app.properties.template.scale.maxReplicas = 2;
  },
  "production target": (e) => {
    e.app.name = "ca-kovagpt-prod";
  },
  "plain key value": (e) => {
    e.app.properties.template.containers[0].env.find((x) => x.name === "ELEVENLABS_API_KEY").value =
      "fixture-private-not-live";
  },
  "provider substitution": (e) => {
    e.providerBindings.textProvider = "azure_openai";
  },
  "voice mismatch": (e) => {
    e.providerBindings.voiceId = "otherVoice";
  },
  "missing price evidence": (e) => {
    e.providerBindings.exactPricingEvidenceSha256 = null;
  },
  "base CI substituted": (e) => {
    e.ci.sourceSha = "e".repeat(40);
  },
  "stale capture": (e) => {
    e.collectedAt = new Date(now - 600001).toISOString();
  },
  "disabled-operation flag": (e) => {
    e.app.properties.template.containers[0].env.find(
      (x) => x.name === "KOVA_GENERATION_ACCEPTANCE_ENABLED",
    ).value = "false";
  },
  "missing application version": (e) => {
    e.version.sha = "unknown";
  },
  "missing runtime plan": (e) => {
    e.app.properties.template.containers[0].env.find(
      (x) => x.name === "KOVA_GENERATION_ACCEPTANCE_PLAN",
    ).value = "";
  },
  "runtime model unsupported by guard": (e) => {
    e.providerBindings.modelId = "different-model";
    for (const name of ["KOVA_INSTANT_MODEL", "KOVA_MODEL_DEFAULT_CHAT"])
      e.app.properties.template.containers[0].env.find((x) => x.name === name).value =
        "different-model";
  },
})) {
  test(`rejects ${name}`, () => {
    const e = fixture();
    change(e);
    assert.throws(() => check(e), /^Error: generation_staging_/);
  });
}
