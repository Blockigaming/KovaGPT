#!/usr/bin/env node
import { args, jsonFile, namesFromInput, print, result } from "./lib.mjs";

const cli = args();
if (cli.help || !cli.input) {
  console.log(
    "Usage: node scripts/staging-validation/environment-diff.mjs --input <names.txt|sanitized.json> [--scope production|preview]",
  );
  process.exit(cli.help ? 0 : 2);
}
const scope = cli.scope || "production";
const contract = jsonFile("docs/production-readiness/environment-contract.json");
const supplied = new Set(namesFromInput(cli.input));
const expected = contract.variables.filter((variable) => variable.environmentScope.includes(scope));
const checks = [];
for (const variable of expected) {
  if (variable.required && !supplied.has(variable.name))
    checks.push({ status: "BLOCKER", code: "required_missing", name: variable.name });
}
for (const name of supplied) {
  const variable = contract.variables.find((item) => item.name === name);
  if (!variable) checks.push({ status: "WARNING", code: "unexpected_name", name });
  if (name.startsWith("VITE_") && variable?.sensitivity === "secret")
    checks.push({ status: "BLOCKER", code: "client_secret", name });
}
for (const name of ["KOVA_GENERATION_DISABLED", "KOVA_PUBLIC_URL", "KOVA_EDGE_ALLOWED_HOSTS"]) {
  checks.push({ status: supplied.has(name) ? "PASS" : "BLOCKER", code: "safety_control", name });
}
for (const name of ["AUTH_MIGRATION_ENABLED", "AUTH_MIGRATION_REHEARSAL"]) {
  if (supplied.has(name) && scope === "production")
    checks.push({ status: "WARNING", code: "migration_flag_requires_value_review", name });
}
print(
  result("environment-diff", checks, {
    scope,
    suppliedCount: supplied.size,
    secretValuesInspected: false,
  }),
);
