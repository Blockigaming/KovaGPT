#!/usr/bin/env node
import { args, jsonFile, print, result, safeOrigin } from "./lib.mjs";

const cli = args();
if (cli.help || !cli.input) {
  console.log("Usage: node scripts/staging-validation/domain-callbacks.mjs --input callbacks.json");
  process.exit(cli.help ? 0 : 2);
}
const data = jsonFile(cli.input);
const checks = [];
for (const [name, value] of Object.entries(data)) {
  if (name === "allowedHosts") {
    checks.push({
      status:
        Array.isArray(value) &&
        !value.some(
          (host) => host === "*" || host.includes("localhost") || host.includes("lovable.app"),
        )
          ? "PASS"
          : "BLOCKER",
      code: "allowed_hosts",
      name,
    });
  } else
    checks.push({
      status: safeOrigin(value) ? "PASS" : "BLOCKER",
      code: "https_external_url",
      name,
    });
}
print(result("domain-callbacks", checks, { mutationRisk: "none" }));
