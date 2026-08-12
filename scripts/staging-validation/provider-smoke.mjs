#!/usr/bin/env node
import { args, print, result, safeOrigin } from "./lib.mjs";

const cli = args();
if (cli.help) {
  console.log(
    "Usage: STAGING_AUTH_TOKEN=... node scripts/staging-validation/provider-smoke.mjs --url https://<staging>/api/chat --model <configured-id> --execute",
  );
  process.exit(0);
}
const token = process.env.STAGING_AUTH_TOKEN || "";
const maxOutputTokens = Math.min(Number(cli["max-output-tokens"] || 32), 64);
const checks = [
  { status: cli.execute ? "PASS" : "BLOCKER", code: "explicit_execute_required" },
  { status: safeOrigin(cli.url || "") ? "PASS" : "BLOCKER", code: "https_staging_endpoint" },
  { status: token ? "PASS" : "BLOCKER", code: "staging_session_present" },
  { status: cli.model ? "PASS" : "BLOCKER", code: "configured_model_explicit" },
  {
    status: maxOutputTokens > 0 && maxOutputTokens <= 64 ? "PASS" : "BLOCKER",
    code: "bounded_output",
  },
];
let httpStatus = null;
let failureCategory = null;
if (!checks.some((check) => check.status === "BLOCKER")) {
  const response = await fetch(cli.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `staging-smoke-${Date.now()}`,
    },
    body: JSON.stringify({
      model: cli.model,
      input: "Reply with the single word ready.",
      max_output_tokens: maxOutputTokens,
    }),
  });
  httpStatus = response.status;
  failureCategory = response.ok
    ? null
    : response.status === 429
      ? "rate_limit"
      : response.status >= 500
        ? "provider_or_server"
        : "request_rejected";
  checks.push({ status: response.ok ? "PASS" : "BLOCKER", code: "bounded_generation", httpStatus });
  await response.body?.cancel();
}
print(
  result("provider-smoke", checks, {
    executed: cli.execute === true,
    selectedModel: cli.model || null,
    maxOutputTokens,
    httpStatus,
    failureCategory,
    privacyInvariant: "synthetic prompt only",
    billingInvariant: "one idempotent bounded request",
    responseContentPrinted: false,
  }),
);
