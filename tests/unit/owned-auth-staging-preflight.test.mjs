import assert from "node:assert/strict";
import test from "node:test";

import {
  validateOwnedAuthStagingAuthorization,
  validateOwnedAuthStagingConfiguration,
} from "../../scripts/azure/owned-auth-staging-preflight.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const sourceSha = "1".repeat(40);
const sourceTree = "2".repeat(40);
const imageReference = `example.azurecr.io/kovagpt-web@sha256:${"3".repeat(64)}`;
const publicOrigin = "https://ca-kovagpt-staging.example.azurecontainerapps.io";
const targetId = `/subscriptions/${subscriptionId}/resourceGroups/rg-kovagpt-staging/providers/Microsoft.App/containerApps/ca-kovagpt-staging`;
const now = Date.parse("2026-10-19T23:00:00.000Z");

function fixture() {
  const values = {
    AZURE_ENVIRONMENT: "staging",
    KOVA_AUTH_MODE: "kova",
    KOVA_AUTH_PUBLIC_ORIGIN: publicOrigin,
    KOVA_AUTH_ORIGIN: publicOrigin,
    KOVA_AUTH_ISSUER: "https://staging.example/auth/v1",
    KOVA_AUTH_ENCRYPTION_KEY_SHA256: "4".repeat(64),
    KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: "5".repeat(64),
    KOVA_AUTH_JWT_KEY_ID: "staging-key",
    AI_GENERATION_ENABLED: "false",
    KOVA_GENERATION_DISABLED: "true",
    KOVA_EMAIL_QUEUE_ENABLED: "true",
  };
  const secrets = [
    "KOVA_AUTH_ENCRYPTION_KEY",
    "KOVA_AUTH_JWT_PRIVATE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  return {
    subscriptionId,
    sourceSha,
    sourceTree,
    imageReference,
    publicOrigin,
    app: {
      name: "ca-kovagpt-staging",
      id: targetId,
      type: "Microsoft.App/containerApps",
      properties: {
        configuration: {
          ingress: { allowInsecure: false, fqdn: new URL(publicOrigin).hostname },
          secrets: secrets.map((name) => ({ name: name.toLowerCase().replaceAll("_", "-") })),
        },
        template: {
          containers: [
            {
              image: imageReference,
              env: [
                ...Object.entries(values).map(([name, value]) => ({ name, value })),
                ...secrets.map((name) => ({
                  name,
                  secretRef: name.toLowerCase().replaceAll("_", "-"),
                })),
              ],
            },
          ],
        },
      },
    },
    browserProvenance: {
      verification: "verified-build-time-browser-config",
      sourceContext: "git-archive",
      sourceSha,
      sourceTree,
      authMode: "kova",
      browserBundleSha256: "6".repeat(64),
    },
    approval: {
      environment: "staging",
      targetId,
      sourceSha,
      imageReference,
      deployAuthorized: true,
      attempts: 1,
      currency: "USD",
      maximumCostMinor: 0,
      quotedMaximumCostMinor: 0,
      stopAt: "2026-10-19T23:20:00.000Z",
      stopSafeguardVerified: true,
    },
  };
}

test("existing staging target and compiled pure-Kova provenance validate without resolving secrets", () => {
  const packet = fixture();
  const configuration = validateOwnedAuthStagingConfiguration(packet);
  assert.equal(configuration.authMode, "kova");
  assert.equal(configuration.activationVerified, false);
  assert.equal(configuration.targetId, targetId);
  assert.deepEqual(
    validateOwnedAuthStagingAuthorization({ configuration, approval: packet.approval, now }),
    {
      authorizedTarget: "ca-kovagpt-staging",
      attempts: 1,
      boundedAuthorization: true,
    },
  );
});

test("production, rehearsal, changed source/image, duplicate env and browser mode drift fail closed", () => {
  const mutations = [
    (p) => {
      p.app.name = "ca-kovagpt-auth-rehearsal";
    },
    (p) => {
      p.app.id = p.app.id.replace("rg-kovagpt-staging", "rg-kovagpt-prod");
    },
    (p) => {
      p.imageReference = "example.azurecr.io/kovagpt-web:latest";
    },
    (p) => {
      p.browserProvenance.sourceSha = "7".repeat(40);
    },
    (p) => {
      p.browserProvenance.authMode = "supabase";
    },
    (p) => {
      p.app.properties.template.containers[0].env.push({ name: "KOVA_AUTH_MODE", value: "kova" });
    },
    (p) => {
      p.app.properties.configuration.ingress.fqdn = "kovagpt.com";
    },
  ];
  for (const mutate of mutations) {
    const packet = fixture();
    mutate(packet);
    assert.throws(
      () => validateOwnedAuthStagingConfiguration(packet),
      /^Error: kova_auth_staging_[a-z_]+$/u,
    );
  }
});

test("plaintext key, missing secret and enabled generation fail with sanitized error codes", () => {
  for (const change of ["plaintext", "missing", "generation"]) {
    const packet = fixture();
    const env = packet.app.properties.template.containers[0].env;
    if (change === "plaintext")
      env.find((entry) => entry.name === "KOVA_AUTH_JWT_PRIVATE_KEY").value =
        "private-fixture-never-echo";
    if (change === "missing") packet.app.properties.configuration.secrets = [];
    if (change === "generation")
      env.find((entry) => entry.name === "AI_GENERATION_ENABLED").value = "true";
    assert.throws(
      () => validateOwnedAuthStagingConfiguration(packet),
      (error) => {
        assert.match(error.message, /^kova_auth_staging_[a-z_]+$/u);
        assert.doesNotMatch(error.message, /private-fixture/u);
        return true;
      },
    );
  }
});

test("authorization is target/image/source bound with a numeric budget and verified stop safeguard", () => {
  const packet = fixture();
  const configuration = validateOwnedAuthStagingConfiguration(packet);
  for (const patch of [
    { deployAuthorized: false },
    { sourceSha: "7".repeat(40) },
    { targetId: `${targetId}-other` },
    { attempts: 2 },
    { maximumCostMinor: undefined },
    { quotedMaximumCostMinor: 1 },
    { stopAt: "2026-10-19T22:59:59.000Z" },
    { stopSafeguardVerified: false },
  ]) {
    assert.throws(
      () =>
        validateOwnedAuthStagingAuthorization({
          approval: { ...packet.approval, ...patch },
          configuration,
          now,
        }),
      /^Error: kova_auth_staging_[a-z_]+$/u,
    );
  }
});
