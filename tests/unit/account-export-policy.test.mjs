import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_EXPORT_COOLDOWN_SECONDS,
  ACCOUNT_EXPORT_RATE_LIMIT,
  ACCOUNT_EXPORT_DIRECT_TABLES,
  accountExportCooldownRetryAfter,
  accountExportJobCooldownRetryAfter,
  accountExportStoragePrefix,
  accountExportStoragePath,
  publicAccountExportJob,
  sanitizeAccountExportValue,
  serializeAccountExport,
} from "../../src/lib/account-export-policy.mjs";
import { consumeDistributedRateLimit } from "../../src/lib/distributed-rate-limit.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";

test("account export throttling uses the supported limiter contract and a durable cooldown", async () => {
  assert.deepEqual(ACCOUNT_EXPORT_RATE_LIMIT, {
    action: "account_data_export",
    limit: 2,
    windowSeconds: 3_600,
  });
  const unavailable = await consumeDistributedRateLimit({
    identity: `user:${userId}`,
    ...ACCOUNT_EXPORT_RATE_LIMIT,
    backendUrl: null,
    serviceRoleKey: null,
    hashSecret: null,
  });
  assert.equal(unavailable.status, "unavailable");

  const now = Date.parse("2026-09-03T20:00:00.000Z");
  assert.throws(() => accountExportCooldownRetryAfter(null, now), /job_invalid/u);
  assert.equal(
    accountExportCooldownRetryAfter("2026-09-03T19:00:00.000Z", now),
    ACCOUNT_EXPORT_COOLDOWN_SECONDS - 60 * 60,
  );
  assert.equal(accountExportCooldownRetryAfter("2026-09-03T08:00:00.000Z", now), 0);
  assert.throws(() => accountExportCooldownRetryAfter("not-a-date", now), /job_invalid/u);
});

test("audit setup failures remain retryable without bypassing the distributed limiter", () => {
  const now = Date.parse("2026-09-03T20:00:00.000Z");
  const requestedAt = "2026-09-03T19:00:00.000Z";
  assert.equal(
    accountExportJobCooldownRetryAfter(
      {
        status: "failed",
        failureCode: "account_export_audit_failed",
        requestedAt,
      },
      now,
    ),
    0,
  );
  assert.equal(
    accountExportJobCooldownRetryAfter(
      { status: "failed", failureCode: "account_export_generation_failed", requestedAt },
      now,
    ),
    ACCOUNT_EXPORT_COOLDOWN_SECONDS - 60 * 60,
  );
  assert.throws(() => accountExportJobCooldownRetryAfter(null, now), /job_invalid/u);
});

test("account exports recursively remove credentials and private moderation notes", () => {
  const sanitized = sanitizeAccountExportValue({
    id: "safe",
    idempotency_key: "safe-business-key",
    token_ciphertext: "never-export",
    state_hash: "never-export",
    nested: {
      refresh_token: "never-export",
      private_notes: "never-export",
      safe_description: "kept",
    },
    values: [{ client_secret: "never-export", status: "connected" }],
  });
  assert.deepEqual(sanitized, {
    id: "safe",
    idempotency_key: "safe-business-key",
    nested: { safe_description: "kept" },
    values: [{ status: "connected" }],
  });
  assert.doesNotMatch(JSON.stringify(sanitized), /never-export/u);
});

test("account export artifacts are deterministic compact JSON with a final newline", () => {
  const result = serializeAccountExport({ format: "kovagpt-account-export", rows: [{ ok: true }] });
  assert.equal(result.text, '{"format":"kovagpt-account-export","rows":[{"ok":true}]}\n');
  assert.deepEqual(JSON.parse(result.text), {
    format: "kovagpt-account-export",
    rows: [{ ok: true }],
  });
  assert.equal(result.bytes.byteLength, new TextEncoder().encode(result.text).byteLength);
});

test("private export paths are strictly principal and job scoped", () => {
  const artifactId = "33333333-3333-4333-8333-333333333333";
  assert.equal(accountExportStoragePrefix(userId, jobId), `${userId}/${jobId}`);
  assert.equal(
    accountExportStoragePath(userId, jobId, artifactId),
    `${userId}/${jobId}/${artifactId}.json`,
  );
  assert.throws(
    () => accountExportStoragePath("../other-user", jobId, artifactId),
    /path_invalid/u,
  );
  assert.throws(() => accountExportStoragePath(userId, "not-a-job", artifactId), /path_invalid/u);
  assert.throws(() => accountExportStoragePath(userId, jobId, "not-an-artifact"), /path_invalid/u);
});

test("public job state never exposes storage paths or expired downloads", () => {
  const now = new Date("2026-09-03T20:00:00.000Z");
  const ready = publicAccountExportJob(
    {
      id: jobId,
      status: "complete",
      requested_at: "2026-09-03T19:00:00.000Z",
      completed_at: "2026-09-03T19:05:00.000Z",
      expires_at: "2026-09-10T19:05:00.000Z",
      size_bytes: 1234,
      storage_path: `${userId}/${jobId}/33333333-3333-4333-8333-333333333333.json`,
      content_sha256: "a".repeat(64),
    },
    now,
  );
  assert.equal(ready.downloadable, true);
  assert.equal("storagePath" in ready, false);

  const expired = publicAccountExportJob(
    { ...ready, id: jobId, status: "complete", expires_at: "2026-09-02T00:00:00.000Z" },
    now,
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.downloadable, false);

  const cleanupPending = publicAccountExportJob({
    ...ready,
    id: jobId,
    status: "canceled",
    storage_path: `${userId}/${jobId}/33333333-3333-4333-8333-333333333333.json`,
  });
  assert.equal(cleanupPending.cleanupPending, true);
  assert.equal("storagePath" in cleanupPending, false);
});

test("the direct export allowlist contains no credential-state tables", () => {
  const names = ACCOUNT_EXPORT_DIRECT_TABLES.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.includes("google_oauth_tokens"), false);
  assert.equal(names.includes("github_oauth_states"), false);
  assert.equal(names.includes("integration_oauth_states"), false);
  assert.equal(names.includes("email_unsubscribe_tokens"), false);
  assert.equal(names.includes("work_saved_records"), true);
  assert.equal(names.includes("work_recent_items"), true);
  assert.equal(names.includes("work_sync_counters"), false);
  assert.equal(names.includes("work_sync_mutations"), false);
  assert.equal(names.includes("library_folders"), true);
  assert.equal(names.includes("library_folder_locks"), false);
  assert.equal(names.includes("project_templates"), true);
  assert.equal(names.includes("project_template_versions"), true);
  assert.equal(names.includes("project_template_grants"), true);
  assert.equal(names.includes("project_template_audit_events"), true);
  assert.equal(names.includes("project_template_mutations"), false);
  // Site bodies use the cumulative byte-limited file collector, never a
  // direct select(*) that materializes all base64 content before size checks.
  assert.equal(names.includes("kova_site_files"), false);
});
