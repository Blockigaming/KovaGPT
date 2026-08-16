import assert from "node:assert/strict";
import test from "node:test";

import { analyzeMigrationManifest, normalizeRemoteVersions, reconcileMigrationVersions } from "../../scripts/release/migration-preflight.mjs";
import { assertSafeRlsTarget, validateRlsMatrix } from "../../scripts/release/rls-two-user.mjs";
import { normalizeStripeEnvironmentValue, verifyStripeTestPath } from "../../scripts/release/stripe-test-path.mjs";
import { verifyAiProviderContract } from "../../scripts/release/ai-provider-contract.mjs";
import { inspectLockRoot, inspectPackageManifest } from "../../scripts/release/zero-lovable.mjs";
import { validateRollbackEvidence } from "../../scripts/release/rollback-evidence.mjs";

test("migration preflight detects duplicates and reconciles remote history", () => {
  const manifest = {
    count: 2,
    latest: "20260101000001_b.sql",
    migrations: [
      { order: 1, filename: "20260101000000_a.sql", sha256: "a".repeat(64), destructive: false, dataBackfill: false, rls: ["a"], functions: [] },
      { order: 2, filename: "20260101000001_b.sql", sha256: "a".repeat(64), destructive: true, dataBackfill: true, rls: [], functions: ["f"] },
    ],
  };
  const analysis = analyzeMigrationManifest(manifest);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.duplicateContent.length, 1);
  assert.equal(analysis.destructive, 1);
  const remote = normalizeRemoteVersions({ migrations: [{ version: "20260101000000" }] });
  assert.deepEqual(reconcileMigrationVersions(analysis.versions, remote), {
    pending: ["20260101000001"], unknownRemote: [], applied: ["20260101000000"],
  });
});

test("RLS matrix is complete and production execution is prohibited", () => {
  const matrix = { schemaVersion: 1, protectedTables: [{ table: "projects", accessModel: "project_membership", operations: ["select", "update", "delete"], fixture: null }] };
  assert.deepEqual(validateRlsMatrix(matrix, { tables: ["projects"] }), { protectedTableCount: 1, fixtureCount: 0 });
  assert.throws(() => assertSafeRlsTarget({ supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", expectedRef: "abcdefghijklmnopqrst", productionRef: "abcdefghijklmnopqrst", execute: true }), /production_target_prohibited/u);
});

test("Stripe sandbox is supported without weakening environment allowlisting", () => {
  assert.equal(normalizeStripeEnvironmentValue("sandbox"), "sandbox");
  assert.equal(normalizeStripeEnvironmentValue("live"), "live");
  assert.equal(normalizeStripeEnvironmentValue("test"), null);
  assert.deepEqual(verifyStripeTestPath({
    webhookSource: 'normalizeStripeEnvironment value === "sandbox" || value === "live" processed_stripe_events 23505',
    stripeSource: "PAYMENTS_SANDBOX_WEBHOOK_SECRET PAYMENTS_LIVE_WEBHOOK_SECRET timingSafeEqual",
    planSource: "plus_monthly pro_monthly",
  }), []);
});

test("zero-Lovable dependency and lock checks are deterministic", () => {
  assert.deepEqual(inspectPackageManifest({ dependencies: { "@lovable.dev/email-js": "1" } }), ["dependencies:@lovable.dev/email-js"]);
  assert.deepEqual(inspectPackageManifest({ dependencies: { react: "1" } }), []);
  assert.deepEqual(inspectLockRoot({ packages: { "": { dependencies: { "@lovable.dev/email-js": "1" } } } }), ["@lovable.dev/email-js"]);
});

test("Azure provider contract requires GPT-5.6 Sol and managed identity", () => {
  const provider = 'type ProviderKind = "azure_openai" | "openai"; https://api.openai.com/v1 .openai.azure.com .services.ai.azure.com /openai/v1 IDENTITY_ENDPOINT IDENTITY_HEADER https://cognitiveservices.azure.com/.default redirect: "error" "/responses" responsesStreamToChatStream AZURE_OPENAI_DEPLOYMENT_DEEP';
  const catalog = 'id: "gpt-5.6-sol", reasoning: true, vision: true, tools: true fallback: "gpt-5.6-sol"';
  const staging = "Cognitive Services OpenAI User name: 'AZURE_CLIENT_ID' AZURE_OPENAI_DEPLOYMENT_DEEP";
  assert.deepEqual(verifyAiProviderContract({ provider, catalog, staging }), []);
});

test("rollback evidence rejects placeholders and accepts distinct immutable images", () => {
  assert.ok(validateRollbackEvidence({}).length > 0);
  const valid = {
    releaseSha: "a".repeat(40), candidateImageDigest: `sha256:${"b".repeat(64)}`, previousImageDigest: `sha256:${"c".repeat(64)}`,
    candidateRevision: "candidate", previousRevision: "previous", backupReference: "backup", databaseCompatibility: "expand-contract compatible",
    authMigrationState: "not_started", cloudflareOriginState: "origin unchanged", restoreCommand: "az containerapp ingress traffic set ...", verificationCommand: "curl health and version",
  };
  assert.deepEqual(validateRollbackEvidence(valid), []);
});
