import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = process.cwd();
const rules = [
  {
    label: "raw exception in JSON error response",
    pattern:
      /Response\.json\([\s\S]{0,600}?\berror\s*:\s*(?:error|e)\s+instanceof\s+Error\s*\?\s*(?:error|e)\.message/iu,
  },
  {
    label: "raw exception message in response object",
    pattern: /\bmessage\s*:\s*\((?:error|e)\s+as\s+Error\)\.message/iu,
  },
  {
    label: "provider callback error reflected into redirect",
    pattern: /searchParams\.set\([^,]+,\s*providerError\s*\)/u,
  },
  {
    label: "raw exception logged from public API route",
    pattern:
      /console\.(?:log|info|warn|error|debug)\([\s\S]{0,500}?(?:error|e)\s+instanceof\s+Error\s*\?\s*(?:error|e)\.message/iu,
  },
];

function apiRouteFiles() {
  return execFileSync("git", ["ls-files", "src/routes/api"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((path) => /\.(?:ts|tsx|js|mjs)$/u.test(path));
}

export function inspectPublicErrorContract({ files = apiRouteFiles() } = {}) {
  const errors = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const rule of rules) if (rule.pattern.test(source)) errors.push(`${path}:${rule.label}`);
  }
  return [...new Set(errors)].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = inspectPublicErrorContract();
  if (errors.length) {
    console.error(`Public error contract failed:\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("PUBLIC_ERROR_CONTRACT=PASS rawExceptionsExposed=0 rawExceptionsLogged=0");
}
