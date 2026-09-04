import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const readable = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".html",
  ".map",
  ".css",
  ".json",
  ".env",
]);
const secretPatterns = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /\b(?:sk|fc)-[A-Za-z0-9_-]{24,}/,
];
const publicSecretNamePatterns = [
  /VITE_(?:OPENAI|LOVABLE|FIRECRAWL|ANTHROPIC)[A-Z0-9_]*(?:KEY|SECRET|TOKEN)/,
  /NEXT_PUBLIC_(?:OPENAI|LOVABLE|FIRECRAWL|ANTHROPIC)[A-Z0-9_]*(?:KEY|SECRET|TOKEN)/,
];
const lovableRuntime = /ai\.gateway\.lovable\.dev|LOVABLE_(?:API_KEY|AI_BASE_URL)|Lovable-API-Key/;
const documentedFakeCredentialFixtures = new Map([
  [
    "scripts/security/scan-ai-runtime.mjs",
    ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "sk-proj_abcdefghijklmnopqrstuvwxyz0123456789"],
  ],
  ["tests/unit/artifact-secret-scan.test.mjs", ["sk-proj-abcdefghijklmnopqrstuvwxyz123456"]],
  [
    "tests/unit/azure-browser-config-provenance.test.mjs",
    ["sk-proj_abcdefghijklmnopqrstuvwxyz0123456789"],
  ],
]);
const negativeLovableRuleFiles = new Set([
  "scripts/azure/validate-staging-template.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/release/artifact-secret-scan.mjs",
  "scripts/release/zero-lovable.mjs",
  "scripts/security/scan-ai-runtime.mjs",
]);
const browserProvider =
  /https:\/\/(?:api\.openai\.com|[^/]+\.(?:openai\.azure\.com|services\.ai\.azure\.com))\/[^\s"']*(?:responses|chat\/completions|images|embeddings)/;
const unsafeLogging =
  /console\.(?:log|info|warn|error)\([^)]{0,500}(?:authorization|request\.headers|process\.env)/i;
const violations = [];

function inspect(file, scope) {
  const rel = relative(root, file);
  if (rel.includes("node_modules/") || rel.startsWith(".git/")) return;
  if (!readable.has(extname(file)) && !/\.(?:env\.example|wrangler\.jsonc)$/.test(file)) return;
  const source = readFileSync(file, "utf8");
  const sourceWithoutFakeFixtures = (documentedFakeCredentialFixtures.get(rel) ?? []).reduce(
    (text, fixture) => text.replaceAll(fixture, "<documented-fake-credential>"),
    source,
  );
  for (const rule of secretPatterns)
    if (rule.test(sourceWithoutFakeFixtures)) violations.push(`${rel}: credential pattern`);
  if (!rel.startsWith("tests/") && !negativeLovableRuleFiles.has(rel)) {
    for (const rule of publicSecretNamePatterns)
      if (rule.test(source)) violations.push(`${rel}: browser credential variable`);
  }
  if (
    lovableRuntime.test(source) &&
    !rel.startsWith("docs/") &&
    !rel.startsWith("tests/") &&
    !negativeLovableRuleFiles.has(rel)
  )
    violations.push(`${rel}: Lovable AI production path`);
  if (scope === "browser" && browserProvider.test(source))
    violations.push(`${rel}: direct browser provider request`);
  if (scope !== "fixtures" && unsafeLogging.test(source))
    violations.push(`${rel}: unsafe authorization/environment logging`);
  for (const name of ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "FIRECRAWL_API_KEY"]) {
    const value = process.env[name];
    if (value && value.length >= 16 && source.includes(value))
      violations.push(`${rel}: injected ${name} value`);
  }
}
function walk(path, scope) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) walk(file, scope);
    else inspect(file, scope);
  }
}

for (const path of ["src/components", "src/hooks", "src/integrations", "src/routes"])
  walk(join(root, path), "browser");
walk(join(root, "dist/client"), "browser");
walk(join(root, "dist/server"), "server");
walk(join(root, "tests"), "fixtures");
for (const path of execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n"))
  if (path) inspect(join(root, path), path.startsWith("tests/") ? "fixtures" : "source");

if (violations.length) {
  console.error(`AI runtime security scan failed:\n${[...new Set(violations)].join("\n")}`);
  process.exit(1);
}
console.log(
  "AI runtime security scan passed: source, browser/server bundles, maps, assets, and fixtures contain no exposed provider secret or Lovable AI production path.",
);
