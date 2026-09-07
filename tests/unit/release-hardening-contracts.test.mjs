import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMigrationManifest,
  assertLineageSourceVersionsRepaired,
  assertRemoteLineageInventory,
  classifyRemoteMigrationLineage,
  normalizeRemoteVersions,
  reconcileMigrationVersions,
  validateRemoteMigrationEvidence,
  validateSchemaProofEvidence,
  validateMigrationLineage,
} from "../../scripts/release/migration-preflight.mjs";
import { assertSafeRlsTarget, validateRlsMatrix } from "../../scripts/release/rls-two-user.mjs";
import {
  normalizeStripeEnvironmentValue,
  verifyCheckoutRequestBoundary,
  verifyStripeTestPath,
} from "../../scripts/release/stripe-test-path.mjs";
import { verifyAiProviderContract } from "../../scripts/release/ai-provider-contract.mjs";
import { inspectLockRoot, inspectPackageManifest } from "../../scripts/release/zero-lovable.mjs";
import { validateRollbackEvidence } from "../../scripts/release/rollback-evidence.mjs";

test("migration preflight detects duplicates and reconciles remote history", () => {
  const manifest = {
    count: 2,
    latest: "20260101000001_b.sql",
    migrations: [
      {
        order: 1,
        filename: "20260101000000_a.sql",
        sha256: "a".repeat(64),
        destructive: false,
        dataBackfill: false,
        rls: ["a"],
        functions: [],
      },
      {
        order: 2,
        filename: "20260101000001_b.sql",
        sha256: "a".repeat(64),
        destructive: true,
        dataBackfill: true,
        rls: [],
        functions: ["f"],
      },
    ],
  };
  const analysis = analyzeMigrationManifest(manifest);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.duplicateContent.length, 1);
  assert.equal(analysis.destructive, 1);
  const remote = normalizeRemoteVersions({ migrations: [{ version: "20260101000000" }] });
  assert.deepEqual(reconcileMigrationVersions(analysis.versions, remote), {
    pending: ["20260101000001"],
    unknownRemote: [],
    applied: ["20260101000000"],
  });
});

test("migration lineage makes production drift explicit and blocks unproven mappings", () => {
  const manifest = {
    migrations: [
      {
        timestamp: "20260101000000",
        filename: "20260101000000_source.sql",
        sha256: "a".repeat(64),
      },
      {
        timestamp: "20260101000001",
        filename: "20260101000001_candidate.sql",
        sha256: "b".repeat(64),
      },
    ],
  };
  const lineage = {
    schemaVersion: 1,
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 4,
    observedSourceMigrationCount: 2,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "equivalent",
        status: "equivalent",
        sourceVersion: "20260101000000",
        sourceFilename: "20260101000000_source.sql",
        sourceSha256: "a".repeat(64),
        comparison: "exact-content",
      },
      {
        remoteVersion: "20260102000001",
        remoteName: "requires proof",
        status: "requires_schema_proof",
        candidateSourceVersions: ["20260101000001"],
        reason: "names alone do not prove schema equivalence",
      },
    ],
  };
  assert.deepEqual(validateMigrationLineage(lineage, manifest), {
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 4,
    observedSourceMigrationCount: 2,
    remoteVersions: ["20260102000000", "20260102000001"],
    equivalent: 1,
    schemaProven: 0,
    requiresSchemaProof: 1,
  });
  assert.deepEqual(
    classifyRemoteMigrationLineage(["20260102000000", "20260102000001", "20260102000002"], lineage),
    {
      unknownRemote: ["20260102000002"],
      equivalent: [{ remoteVersion: "20260102000000", sourceVersion: "20260101000000" }],
      schemaProven: [],
      requiresSchemaProof: ["20260102000001"],
    },
  );
});

test("migration lineage binds a complete remote export and permits clean targets", () => {
  const manifest = {
    migrations: [{ timestamp: "20260101000000" }, { timestamp: "20260101000001" }],
  };
  const cleanLineage = {
    schemaVersion: 1,
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 2,
    observedSourceMigrationCount: 2,
    entries: [],
  };
  const analysis = validateMigrationLineage(cleanLineage, manifest);
  const remote = validateRemoteMigrationEvidence({
    targetProjectRef: "abcdefghijklmnopqrst",
    migrationCount: 2,
    migrations: ["20260101000000", "20260101000001"],
  });
  const reconciliation = reconcileMigrationVersions(
    ["20260101000000", "20260101000001"],
    remote.versions,
  );
  assert.doesNotThrow(() => assertRemoteLineageInventory(analysis, remote, reconciliation));
  assert.throws(
    () => assertRemoteLineageInventory(analysis, { ...remote, migrationCount: 0 }, reconciliation),
    /migration_lineage_remote_count_mismatch/u,
  );
  assert.throws(
    () =>
      assertRemoteLineageInventory(analysis, remote, {
        ...reconciliation,
        unknownRemote: ["20260102000000"],
      }),
    /migration_lineage_remote_inventory_mismatch/u,
  );
  assert.throws(
    () =>
      validateRemoteMigrationEvidence({
        targetProjectRef: "abcdefghijklmnopqrst",
        migrationCount: 1,
        migrations: [],
      }),
    /remote_migration_evidence_count_invalid/u,
  );
});

test("schema-proven lineage requires matching external fingerprint evidence and repaired history", () => {
  const fingerprint = {
    schemaSha256: "a".repeat(64),
    aclSha256: "b".repeat(64),
    rlsSha256: "c".repeat(64),
    functionSha256: "d".repeat(64),
  };
  const lineage = {
    schemaVersion: 1,
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 3,
    observedSourceMigrationCount: 1,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "reconciled",
        status: "schema_proven",
        sourceVersions: ["20260101000000"],
        comparison: "schema-acl-rls-function-fingerprint",
        proofId: "proof-20260102000000",
      },
    ],
  };
  const manifest = { migrations: [{ timestamp: "20260101000000" }] };
  const analysis = validateMigrationLineage(lineage, manifest);
  assert.equal(analysis.schemaProven, 1);
  const remote = {
    targetProjectRef: "abcdefghijklmnopqrst",
    migrationCount: 3,
    versions: ["20260101000000", "20260102000000", "20260103000000"],
  };
  const proof = {
    schemaVersion: 1,
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 3,
    proofs: [
      {
        proofId: "proof-20260102000000",
        remoteVersion: "20260102000000",
        sourceVersions: ["20260101000000"],
        sourceFingerprint: fingerprint,
        remoteFingerprint: { ...fingerprint },
      },
    ],
  };
  assert.deepEqual(validateSchemaProofEvidence(proof, lineage, remote), { proofCount: 1 });
  assert.throws(
    () =>
      validateSchemaProofEvidence(
        {
          ...proof,
          proofs: [
            {
              ...proof.proofs[0],
              remoteFingerprint: { ...fingerprint, aclSha256: "e".repeat(64) },
            },
          ],
        },
        lineage,
        remote,
      ),
    /migration_schema_proof_entry_invalid/u,
  );
  const remoteLineage = classifyRemoteMigrationLineage(["20260102000000"], lineage);
  assert.throws(
    () => assertLineageSourceVersionsRepaired(remoteLineage, ["20260102000000"]),
    /remote_migration_source_history_unrepaired/u,
  );
  assert.doesNotThrow(() =>
    assertLineageSourceVersionsRepaired(remoteLineage, ["20260101000000", "20260102000000"]),
  );
});

test("RLS matrix is executable and production execution is prohibited", () => {
  const matrix = {
    schemaVersion: 2,
    protectedTables: [
      {
        table: "projects",
        accessModel: "project_membership",
        operations: ["select", "update", "delete"],
        fixture: {
          idColumn: "id",
          row: { owner_id: "$USER_A", name: "fixture" },
          updatePatch: { name: "mutated" },
          bindings: { PROJECT_A: "id" },
        },
      },
    ],
  };
  assert.deepEqual(validateRlsMatrix(matrix, { tables: ["projects"] }), {
    protectedTableCount: 1,
    fixtureCount: 1,
    bindings: ["EMAIL_A", "EMAIL_B", "MARKER", "PROJECT_A", "USER_A", "USER_B"],
  });
  assert.throws(
    () =>
      validateRlsMatrix(
        {
          schemaVersion: 2,
          protectedTables: [
            {
              table: "projects",
              accessModel: "project_membership",
              operations: ["select", "update", "delete"],
              fixture: null,
            },
          ],
        },
        { tables: ["projects"] },
      ),
    /fixture_missing/u,
  );
  assert.throws(
    () =>
      assertSafeRlsTarget({
        supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
        expectedRef: "abcdefghijklmnopqrst",
        productionRef: "abcdefghijklmnopqrst",
        execute: true,
      }),
    /production_target_prohibited/u,
  );
});

test("Stripe release contract pins the API and embedded Checkout identity", () => {
  assert.equal(normalizeStripeEnvironmentValue("sandbox"), "sandbox");
  assert.equal(normalizeStripeEnvironmentValue("live"), "live");
  assert.equal(normalizeStripeEnvironmentValue("test"), null);
  assert.deepEqual(verifyCheckoutRequestBoundary(), []);

  const valid = {
    webhookSource:
      'normalizeStripeEnvironment value === "sandbox" || value === "live" processStripeEvent createStripeClient webhook_processing_failed status: verificationFailure ? 400 : 503',
    stripeSource:
      'PAYMENTS_SANDBOX_WEBHOOK_SECRET PAYMENTS_LIVE_WEBHOOK_SECRET timingSafeEqual apiVersion: "2026-08-26.dahlia"',
    planSource: "plus_monthly pro_monthly",
    checkoutSource:
      '.validator((data: unknown) => { const parsed = parseCheckoutRequest(data); if (!resolveBillingPlan(parsed.priceId)) throw new Error("Invalid priceId"); return parsed; }) const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = { integration_identifier: "kovagpt_checkout_wshrfyef", return_url: CHECKOUT_RETURN_URL }; stripe.checkout.sessions.create(sessionParams)',
  };
  assert.deepEqual(verifyStripeTestPath(valid), []);

  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      stripeSource: valid.stripeSource.replace("2026-08-26", "2026-07-29"),
    }),
    ["current Stripe API version missing"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace(
        'integration_identifier: "kovagpt_checkout_wshrfyef"',
        "",
      ),
    }),
    ["embedded Checkout integration identifier missing"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace("wshrfyef", "INVALID"),
    }),
    ["embedded Checkout integration identifier malformed"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace("wshrfyef", "abcdefgh"),
    }),
    ["embedded Checkout integration identifier changed"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: `${valid.checkoutSource} payment_method_types: ["card"]`,
    }),
    ["Checkout payment methods must remain dynamic"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: `${valid.checkoutSource} automatic_tax: { enabled: true }`,
    }),
    ["automatic tax requires approved registrations"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace("return_url: CHECKOUT_RETURN_URL", ""),
    }),
    ["fixed Checkout return URL missing"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: `${valid.checkoutSource} returnUrl: data.returnUrl`,
    }),
    ["Checkout return URL remains browser-selectable"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace("parseCheckoutRequest(data)", ""),
    }),
    ["sanitized Checkout validator missing"],
  );
  assert.deepEqual(
    verifyStripeTestPath({
      ...valid,
      checkoutSource: valid.checkoutSource.replace("return parsed;", "return data;"),
    }),
    ["sanitized Checkout validator missing"],
  );
});

test("zero-Lovable dependency and lock checks are deterministic", () => {
  assert.deepEqual(inspectPackageManifest({ dependencies: { "@lovable.dev/email-js": "1" } }), [
    "dependencies:@lovable.dev/email-js",
  ]);
  assert.deepEqual(inspectPackageManifest({ dependencies: { react: "1" } }), []);
  assert.deepEqual(
    inspectLockRoot({ packages: { "": { dependencies: { "@lovable.dev/email-js": "1" } } } }),
    ["@lovable.dev/email-js"],
  );
});

test("Azure provider contract requires GPT-5.6 Sol and managed identity", () => {
  const provider =
    'type ProviderKind = "azure_openai" | "openai"; https://api.openai.com/v1 .openai.azure.com .services.ai.azure.com /openai/v1 IDENTITY_ENDPOINT IDENTITY_HEADER const AZURE_OPENAI_RESOURCE = "https://cognitiveservices.azure.com" searchParams.set("resource", AZURE_OPENAI_RESOURCE) searchParams.set("api-version", "2019-08-01") redirect: "error" "/responses" responsesStreamToChatStream AZURE_OPENAI_DEPLOYMENT_DEEP';
  const catalog =
    'id: "gpt-5.6-sol", reasoning: true, vision: true, tools: true fallback: "gpt-5.6-sol"';
  const staging =
    "Cognitive Services OpenAI User name: 'AZURE_CLIENT_ID' AZURE_OPENAI_DEPLOYMENT_DEEP";
  assert.deepEqual(verifyAiProviderContract({ provider, catalog, staging }), []);
});

test("rollback evidence rejects placeholders and accepts distinct immutable images", () => {
  assert.ok(validateRollbackEvidence({}).length > 0);
  const valid = {
    releaseSha: "a".repeat(40),
    candidateImageDigest: `sha256:${"b".repeat(64)}`,
    previousImageDigest: `sha256:${"c".repeat(64)}`,
    candidateRevision: "candidate",
    previousRevision: "previous",
    backupReference: "backup",
    databaseCompatibility: "expand-contract compatible",
    authMigrationState: "not_started",
    cloudflareOriginState: "origin unchanged",
    restoreCommand: "az containerapp ingress traffic set ...",
    verificationCommand: "curl health and version",
  };
  assert.deepEqual(validateRollbackEvidence(valid), []);
});
