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
  assert.doesNotMatch(dispatcher, /log\([^\n]*(?:message\.to|message\.subject|message\.html|message\.text)/);
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
    "EMAIL_SENDER_DOMAINS",
    "EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS",
    "EMAIL_WORKER_MAX_ATTEMPTS",
  ]) {
    assert.match(environment, new RegExp(`^${key}=`, "m"));
    assert.ok(docs.includes(`\`${key}\``));
  }
});
