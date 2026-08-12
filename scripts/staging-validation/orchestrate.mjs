#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { args, print, result } from "./lib.mjs";

const cli = args();
if (cli.help) {
  console.log(
    "Usage: npm run staging:validate -- [--environment names.json] [--callbacks callbacks.json] [--azure azure.json]\nRuns deterministic checks; credential-gated checks remain NOT EXECUTED.",
  );
  process.exit(0);
}
const phases = [
  ["environment-contract", "scripts/production-readiness/validate-environment-contract.mjs", []],
  ["artifact", "scripts/staging-validation/artifact.mjs", []],
  ["model-catalog", "scripts/staging-validation/model-catalog.mjs", []],
];
if (cli.environment)
  phases.push([
    "environment-diff",
    "scripts/staging-validation/environment-diff.mjs",
    ["--input", cli.environment],
  ]);
if (cli.callbacks)
  phases.push([
    "callbacks",
    "scripts/staging-validation/domain-callbacks.mjs",
    ["--input", cli.callbacks],
  ]);
if (cli.azure)
  phases.push([
    "azure",
    "scripts/staging-validation/azure-preflight.mjs",
    ["--metadata", cli.azure],
  ]);
const checks = phases.map(([name, script, parameters]) => {
  const run = spawnSync(process.execPath, [script, ...parameters], { encoding: "utf8" });
  return { status: run.status === 0 ? "PASS" : "BLOCKER", code: name, exitCode: run.status };
});
for (const name of ["supabase", "stripe", "provider", "oauth", "dns", "live-health"])
  checks.push({
    status: "WARNING",
    code: name,
    outcome: "NOT EXECUTED — EXTERNAL CREDENTIAL REQUIRED",
  });
print(
  result("staging-orchestrator", checks, {
    executedDeterministic: phases.length,
    credentialGatedNotExecuted: 6,
  }),
);
