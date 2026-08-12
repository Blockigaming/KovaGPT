#!/usr/bin/env node
import { args, jsonFile, print, result, safeOrigin } from "./lib.mjs";

const cli = args();
const kind = cli._[0];
if (
  cli.help ||
  !["supabase", "stripe", "provider", "oauth", "rate-limit", "account-lifecycle"].includes(kind)
) {
  console.log(
    "Usage: node scripts/staging-validation/external-harness.mjs <supabase|stripe|provider|oauth|rate-limit|account-lifecycle> [--fixture sanitized.json] [--execute]\nDry-run/contract validation by default; credentials are never printed.",
  );
  process.exit(cli.help ? 0 : 2);
}
const fixture = cli.fixture ? jsonFile(cli.fixture) : {};
const checks = [];
if (kind === "stripe") {
  checks.push({
    status: fixture.keyMode === "test" ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "test_mode_only",
  });
  checks.push({
    status: fixture.minimumGrossMarginPercent >= 50 ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "margin_floor",
  });
} else if (kind === "supabase") {
  checks.push({
    status: fixture.environment === "staging" ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "staging_only",
  });
  checks.push({
    status:
      fixture.userATokenPresent && fixture.userBTokenPresent
        ? "PASS"
        : cli.execute
          ? "BLOCKER"
          : "WARNING",
    code: "two_user_sessions",
  });
  checks.push({
    status: !fixture.serviceRolePresent ? "PASS" : "BLOCKER",
    code: "no_service_role_browser_checks",
  });
} else if (kind === "provider") {
  checks.push({
    status:
      fixture.maxOutputTokens > 0 && fixture.maxOutputTokens <= 64
        ? "PASS"
        : cli.execute
          ? "BLOCKER"
          : "WARNING",
    code: "bounded_output",
  });
  checks.push({
    status:
      fixture.promptClassification === "synthetic_nonprivate"
        ? "PASS"
        : cli.execute
          ? "BLOCKER"
          : "WARNING",
    code: "nonprivate_prompt",
  });
} else if (kind === "oauth") {
  checks.push({
    status: safeOrigin(fixture.redirectUrl || "") ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "https_redirect",
  });
  checks.push({
    status: fixture.state && fixture.pkce ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "state_pkce",
  });
} else {
  checks.push({
    status: fixture.environment === "staging" ? "PASS" : cli.execute ? "BLOCKER" : "WARNING",
    code: "staging_only",
  });
  checks.push({
    status:
      Number(fixture.maxRequests || 0) > 0 && Number(fixture.maxRequests) <= 20
        ? "PASS"
        : cli.execute
          ? "BLOCKER"
          : "WARNING",
    code: "bounded_execution",
  });
}
print(
  result(`${kind}-harness`, checks, {
    executed: false,
    liveStatus: cli.execute
      ? "BLOCKED_PENDING_EXTERNAL_ENDPOINT_ADAPTER"
      : "NOT EXECUTED — EXTERNAL CREDENTIAL REQUIRED",
    secretValuesPrinted: false,
  }),
);
