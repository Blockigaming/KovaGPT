import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("email execution is a distinct fail-closed worker artifact", () => {
  const runtime = read("worker/src/email-worker.mjs");
  const dispatcher = read("worker/src/email-dispatcher.mjs");
  const docker = read("worker/Dockerfile.email");
  const diagnostic = read("worker/src/index.mjs");

  assert.match(runtime, /loadEmailWorkerConfig\(\)/);
  assert.match(runtime, /GET|request\.method !== "GET"/);
  assert.match(runtime, /request\.url === "\/healthz"/);
  assert.match(runtime, /request\.url === "\/readyz"/);
  assert.match(runtime, /request\.url === "\/metrics"/);
  assert.match(runtime, /agent_execution_enabled: false/);
  assert.match(runtime, /consecutiveFailures/);
  assert.match(dispatcher, /Object\.freeze\(\["auth_emails", "transactional_emails"\]\)/);
  assert.match(dispatcher, /"idempotency-key": message\.idempotencyKey/);
  assert.match(dispatcher, /TERMINAL_LOG_STATUSES\.has/);
  assert.match(dispatcher, /sender_domain_not_allowed/);
  assert.match(dispatcher, /email_log_missing/);
  assert.match(dispatcher, /move_to_dlq/);
  assert.match(dispatcher, /recipient_suppressed/);
  assert.match(dispatcher, /MAX_HTML_BYTES/);
  assert.doesNotMatch(
    dispatcher,
    /log\([^\n]*(?:message\.to|message\.subject|message\.html|message\.text)/,
  );
  assert.match(docker, /USER kova/);
  assert.match(docker, /email-health-check\.mjs/);
  assert.match(docker, /email-worker\.mjs/);
  assert.match(diagnostic, /agent_runtime_unavailable/);
  assert.doesNotMatch(diagnostic, /email-dispatcher|email-worker/);
});

test("email producers and documented environment use the verified sender domain", () => {
  const producer = read("src/routes/api/public/help-submit.ts");
  const environment = read(".env.example");
  const docs = read("docs/email-worker.md");

  assert.match(producer, /notify\.kovagpt\.com/);
  assert.match(producer, /process\.env\.KOVA_EMAIL_FROM/);
  assert.doesNotMatch(producer, /noreply@\$\{FROM_DOMAIN\}/);
  for (const key of [
    "KOVA_EMAIL_QUEUE_ENABLED",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "EMAIL_SENDER_DOMAINS",
    "EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS",
    "EMAIL_WORKER_MAX_ATTEMPTS",
  ]) {
    assert.match(environment, new RegExp(`^${key}=`, "m"));
    assert.ok(docs.includes(`\`${key}\``) || docs.includes(`\`${key}=`));
  }
});

test("Resend delivery reconciliation is signed, replay-safe, and suppression-first", () => {
  const route = read("src/routes/api/public/email/webhook.ts");
  const verifier = read("src/lib/resend-webhook.mjs");
  const migration = read(
    "supabase/migrations/20260904210000_resend_webhook_integrity.sql",
  );
  const docs = read("docs/email-worker.md");

  for (const contract of [
    "readUtf8BodyBounded",
    "svix-id",
    "svix-timestamp",
    "svix-signature",
    "RESEND_WEBHOOK_SECRET",
    "verifyResendWebhookSignature",
    "process_resend_webhook_event",
    "p_payload_sha256",
    "resend_webhook_replay_conflict",
    "Retry-After",
  ]) {
    assert.ok(route.includes(contract), `missing webhook route contract: ${contract}`);
  }
  assert.doesNotMatch(route, /event\.to|data\.to|recipient_email/);
  assert.match(verifier, /crypto\.subtle\.verify\("HMAC"/);
  assert.match(verifier, /Math\.abs\([\s\S]*timestampSeconds\)[\s\S]*toleranceSeconds/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.email_webhook_events/);
  assert.match(migration, /payload_sha256 text NOT NULL/);
  assert.match(migration, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(
    migration,
    /metadata ->> 'provider_id' = p_provider_message_id/,
  );
  assert.match(migration, /ON CONFLICT \(email\) DO NOTHING/);
  assert.match(migration, /'provider_suppression'/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.process_resend_webhook_event[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.process_resend_webhook_event[\s\S]*TO service_role/,
  );
  assert.match(docs, /\/api\/public\/email\/webhook/);
  assert.match(docs, /event-supplied recipients and subjects are never trusted/);
});
