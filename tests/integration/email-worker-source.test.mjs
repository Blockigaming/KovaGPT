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
  assert.match(dispatcher, /dead_letter_tracked_email/);
  assert.match(dispatcher, /defer_email_retry/);
  assert.match(dispatcher, /retryCooldownMs/);
  assert.match(dispatcher, /minimumVisibilitySeconds/);
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
  const readiness = read("src/lib/readiness.server.ts");

  assert.match(producer, /notify\.kovagpt\.com/);
  assert.match(producer, /process\.env\.KOVA_EMAIL_FROM/);
  assert.match(producer, /enqueue_tracked_email/);
  assert.doesNotMatch(producer, /\.from\("email_send_log"\)\.insert/);
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
  assert.doesNotMatch(environment, /^EMAIL_API_KEY=/m);
  assert.match(
    readiness,
    /emailAppConfigured[\s\S]*KOVA_EMAIL_QUEUE_ENABLED[\s\S]*RESEND_WEBHOOK_SECRET[\s\S]*email:\s*capability\(emailAppConfigured\(\)\)/,
  );
  assert.doesNotMatch(readiness, /EMAIL_API_KEY/);
});

test("Resend delivery reconciliation is signed, replay-safe, and suppression-first", () => {
  const route = read("src/routes/api/public/email/webhook.ts");
  const verifier = read("src/lib/resend-webhook.mjs");
  const migration = read("supabase/migrations/20260904210000_resend_webhook_integrity.sql");
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
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_tracked_email/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.dead_letter_tracked_email/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.defer_email_retry/);
  assert.match(migration, /pgmq\.set_vt\(p_queue_name, p_message_id, p_lease_seconds\)/);
  assert.match(migration, /retry_after_until = greatest/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /cron\.unschedule\(target_job_id\)/);
  assert.doesNotMatch(migration, /\^email\\\\\./);
  assert.match(
    migration,
    /pgmq\.send\(p_dlq_name, p_payload\)[\s\S]*pgmq\.delete\(p_source_queue, p_message_id\)[\s\S]*UPDATE public\.email_send_log/,
  );
  assert.match(
    migration,
    /INSERT INTO public\.email_send_log[\s\S]*pgmq\.send\(p_queue_name, p_payload\)/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.enqueue_tracked_email[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.enqueue_tracked_email[\s\S]*TO service_role/,
  );
  assert.match(migration, /payload_sha256 text NOT NULL/);
  assert.match(migration, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(migration, /metadata ->> 'provider_id' = p_provider_message_id/);
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
