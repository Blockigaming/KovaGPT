import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const readable = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".yml", ".yaml", ".toml"]);
const activeRoots = ["src", "scripts", "infra", ".github/workflows"];
const scannerFiles = new Set([
  "scripts/release/architecture-contract.mjs",
  "scripts/release/zero-lovable.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/security/scan-ai-runtime.mjs",
  "scripts/azure/template-contract.mjs",
  "scripts/azure/validate.mjs",
  "scripts/cloudflare/verify-edge-only.mjs",
]);
const prohibitedPaths = [
  "wrangler.jsonc",
  ".github/workflows/deploy-cloudflare-production.yml",
  ".github/workflows/staging-rehearsal.yml",
  "src/lib/legacy-lovable-route.ts",
  "src/routes/[.]lovable.oauth.consent.tsx",
  "src/routes/lovable",
];

function walk(path) {
  if (!existsSync(path)) return [];
  const status = statSync(path);
  if (!status.isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
      .filter((path) => existsSync(join(root, path)));
  } catch {
    return activeRoots.flatMap(walk).map((path) => relative(root, path).replaceAll("\\", "/"));
  }
}

export function auditArchitecture({ files = trackedFiles() } = {}) {
  const errors = [];
  for (const path of prohibitedPaths) {
    if (files.some((file) => file === path || file.startsWith(`${path}/`)) || existsSync(path)) {
      errors.push(`prohibited production artifact: ${path}`);
    }
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(packageJson[group] ?? {})) {
      if (/cloudflare\/vite-plugin|wrangler|lovable/iu.test(name)) {
        errors.push(`prohibited ${group} package: ${name}`);
      }
    }
  }

  const sourceFiles = files.filter((path) =>
    activeRoots.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );
  for (const path of sourceFiles) {
    if (!existsSync(path)) continue;
    if (!readable.has(extname(path)) && !["Dockerfile"].includes(path)) continue;
    if (scannerFiles.has(path)) continue;
    const source = readFileSync(path, "utf8");
    for (const [label, pattern] of [
      [
        "Cloudflare Worker runtime",
        /cloudflare-module|wrangler\s+deploy|@cloudflare\/vite-plugin/iu,
      ],
      [
        "Lovable runtime",
        /@lovable\.dev|(?:ai|connector)-gateway\.lovable\.dev|\b(?:VITE_)?LOVABLE_[A-Z0-9_]+\b/iu,
      ],
      ["mutable production image", /imageReference[^\n]*(?::latest|:main|:production)/iu],
    ]) {
      if (pattern.test(source)) errors.push(`${path}: ${label}`);
    }
  }

  const vite = readFileSync("vite.config.ts", "utf8");
  assert.match(vite, /preset:\s*"node-server"/u, "Nitro must emit a Node server");
  assert.doesNotMatch(vite, /cloudflare-module|@cloudflare\/vite-plugin/u);
  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /CMD \["node", "dist\/server\/index\.mjs"\]/u);
  const productionBicep = readFileSync("infra/azure/production/main.bicep", "utf8");
  assert.match(productionBicep, /KOVA_CLOUDFLARE_EDGE_ONLY/u);
  assert.match(productionBicep, /KOVA_DEEP_MODEL'[\s\S]*gpt-5\.6-sol/u);
  assert.match(productionBicep, /Microsoft\.App\/jobs@2025-01-01/u);
  assert.match(productionBicep, /ipSecurityRestrictions/u);

  return {
    errors: [...new Set(errors)].sort(),
    runtime: "azure-container-apps",
    edge: "cloudflare-only",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = auditArchitecture();
  if (result.errors.length) {
    console.error(`Architecture contract failed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }
  console.log(`KOVA_ARCHITECTURE_CONTRACT=PASS runtime=${result.runtime} edge=${result.edge}`);
}
