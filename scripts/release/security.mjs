import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const readable = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".mjs",
  ".pem",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const fixturePrefixes = ["tests/", "docs/", "scripts/release/security.mjs", "scripts/security/"];
const secretRules = [
  { label: "OpenAI/API bearer key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u },
  { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u },
  { label: "Stripe secret key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u },
  { label: "Stripe webhook secret", pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/u },
  { label: "GitHub token", pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/u },
  { label: "Google OAuth client secret", pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/u },
  { label: "private key material", pattern: /-----BEGIN (?:[A-Z0-9][A-Z0-9 -]* )?PRIVATE KEY-----/u },
  {
    label: "credential-bearing database URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>:@]+:[^\s"'`<>@]+@/iu,
  },
  {
    label: "public secret environment variable",
    pattern: /\b(?:VITE_|NEXT_PUBLIC_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN)\b/u,
  },
];
const sensitiveLoggingExpression =
  /\b(?:authorization|cookie|request\s*\.\s*headers|process\s*\.\s*env|access_token|refresh_token|service_role|client_secret|api[_-]?key|password)\b/iu;
const forbiddenTrackedArtifacts = [
  /^\.env(?:\.|$)(?!example$)/u,
  /(?:^|\/)\.DS_Store$/u,
  /(?:^|\/)npm-debug\.log$/u,
  /(?:^|\/)yarn-error\.log$/u,
  /(?:^|\/)core(?:\.\d+)?$/u,
  /(?:^|\/)\.wrangler\//u,
  /(?:^|\/)\.supabase\//u,
  /(?:^|\/)coverage\//u,
  /(?:^|\/)playwright-report\//u,
  /(?:^|\/)test-results\//u,
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function filesUnder(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

function isFixture(path) {
  return fixturePrefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function stripQuotedText(source) {
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      output += " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function loggingCallArguments(source) {
  const calls = [];
  const matcher = /(?:console\.(?:log|info|warn|error|debug)|logOperationalEvent)\s*\(/gu;
  for (const match of source.matchAll(matcher)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quote = "";
    let escaped = false;
    for (let index = start; index < source.length && index - start < 12_000; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(start, index));
          break;
        }
      }
    }
  }
  return calls;
}

function inspectText(path, source, violations, { built = false } = {}) {
  const fixture = isFixture(path);
  if (!fixture) {
    for (const rule of secretRules) {
      if (rule.pattern.test(source)) violations.push(`${path}:${rule.label}`);
    }
    if (!built) {
      for (const args of loggingCallArguments(source)) {
        if (sensitiveLoggingExpression.test(stripQuotedText(args))) {
          violations.push(`${path}:unsafe credential logging`);
          break;
        }
      }
    }
  }
  if (built && /\bdebugger\s*;/u.test(source)) {
    violations.push(`${path}:debugger statement in built output`);
  }

  for (const name of [
    "OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "PAYMENTS_LIVE_API_KEY",
    "PAYMENTS_SANDBOX_API_KEY",
    "FIRECRAWL_API_KEY",
    "GOOGLE_CLIENT_SECRET",
  ]) {
    const value = process.env[name];
    if (value && value.length >= 12 && source.includes(value)) {
      violations.push(`${path}:injected ${name} value`);
    }
  }
}

export function runReleaseSecurityAudit({ files = trackedFiles() } = {}) {
  const violations = [];

  for (const path of files) {
    for (const rule of forbiddenTrackedArtifacts) {
      if (rule.test(path)) violations.push(`${path}:forbidden tracked artifact`);
    }
    const extension = extname(path).toLowerCase();
    if (!readable.has(extension) && !["Dockerfile", ".env.example", "wrangler.jsonc"].includes(path)) {
      continue;
    }
    inspectText(path, readFileSync(join(root, path), "utf8"), violations);
  }

  for (const directory of ["dist/client", "dist/server"]) {
    for (const absolutePath of filesUnder(join(root, directory))) {
      const extension = extname(absolutePath).toLowerCase();
      if (!readable.has(extension)) continue;
      const path = relative(root, absolutePath).replaceAll("\\", "/");
      inspectText(path, readFileSync(absolutePath, "utf8"), violations, { built: true });
    }
  }

  return [...new Set(violations)].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = runReleaseSecurityAudit();
  if (violations.length) {
    console.error(`Release security audit failed:\n${violations.join("\n")}`);
    process.exit(1);
  }
  console.log(
    "RELEASE_SECURITY_AUDIT=PASS trackedSecrets=0 builtSecrets=0 unsafeCredentialLogs=0 debugArtifacts=0",
  );
}
