import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const scanRoots = (process.env.KOVA_SECRET_SCAN_ROOTS ?? "dist,artifacts,.output")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => resolve(root, value));
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".log",
  ".map",
  ".mjs",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const patterns = [
  ["OpenAI secret key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u],
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/u],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{16,}\b/u],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u],
  ["legacy service-role JWT", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/u],
  ["database credential URL", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/iu],
  ["Azure client secret", /\bAZURE_CLIENT_SECRET\s*[=:]\s*[^\s"']+/iu],
  ["Lovable credential", /\b(?:VITE_)?LOVABLE_[A-Z0-9_]+\s*[=:]/iu],
];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) output.push(...filesUnder(path));
    else if (stats.size <= 20 * 1024 * 1024 && textExtensions.has(extname(path).toLowerCase())) {
      output.push(path);
    }
  }
  return output;
}

export function scanArtifactSecrets({ roots = scanRoots } = {}) {
  const findings = [];
  let filesScanned = 0;
  for (const directory of roots) {
    for (const path of filesUnder(directory)) {
      filesScanned += 1;
      const source = readFileSync(path, "utf8");
      for (const [label, pattern] of patterns) {
        if (pattern.test(source)) {
          findings.push({ path: relative(root, path).replaceAll("\\", "/"), label });
        }
      }
    }
  }
  return { filesScanned, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = scanArtifactSecrets();
  if (result.findings.length) {
    console.error(
      `ARTIFACT_SECRET_SCAN=FAIL\n${result.findings.map(({ path, label }) => `${path}: ${label}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`ARTIFACT_SECRET_SCAN=PASS files=${result.filesScanned}`);
}
