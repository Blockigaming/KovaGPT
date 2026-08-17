import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const strictLock = process.argv.includes("--strict-lock");
const readable = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".mjs",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml",
]);
const ignoredPrefixes = ["artifacts/", "docs/", "tests/"];
const scannerDefinitionFiles = new Set([
  "scripts/release/zero-lovable.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/security/scan-ai-runtime.mjs",
]);
const compatibilityRoutes = new Set([
  "src/routes/lovable/email/auth/preview.ts",
  "src/routes/lovable/email/auth/webhook.ts",
  "src/routes/lovable/email/queue/process.ts",
  "src/routes/lovable/email/suppression.ts",
  "src/routes/lovable/email/transactional/preview.ts",
  "src/routes/lovable/email/transactional/send.ts",
]);
const legacyOauthRedirect = "src/routes/[.]lovable.oauth.consent.tsx";
const forbiddenPatterns = [
  { label: "Lovable SDK import", pattern: /@lovable\.dev\//iu },
  {
    label: "Lovable hosted runtime",
    pattern: /(?:ai|connector)-gateway\.lovable\.dev|lovable\.(?:app|dev)/iu,
  },
  {
    label: "Lovable credential or runtime variable",
    pattern: /\b(?:VITE_)?LOVABLE_[A-Z0-9_]+\b|Lovable-API-Key/iu,
  },
  {
    label: "Lovable billing metadata dependency",
    pattern: /lovable_(?:external_id|managed)/iu,
  },
];

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    const files = [];
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        if ([".git", "node_modules"].includes(name)) continue;
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(relative(root, path).replaceAll("\\", "/"));
      }
    };
    walk(root);
    return files;
  }
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

export function inspectPackageManifest(pkg) {
  const groups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  return groups.flatMap((group) =>
    Object.keys(pkg[group] ?? {})
      .filter((name) => /lovable/iu.test(name))
      .map((name) => `${group}:${name}`),
  );
}

export function inspectLockRoot(lock) {
  return Object.keys(lock.packages?.[""]?.dependencies ?? {}).filter((name) =>
    /lovable/iu.test(name),
  );
}

export function inspectLockGraph(lock) {
  const findings = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (/lovable/iu.test(path)) findings.add(`package:${path}`);
    for (const group of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of Object.keys(entry?.[group] ?? {})) {
        if (/lovable/iu.test(name)) findings.add(`${path || "root"}:${group}:${name}`);
      }
    }
  }
  return [...findings].sort();
}

export function auditZeroLovable({ files = trackedFiles() } = {}) {
  const errors = [];
  const warnings = [];
  const pkg = JSON.parse(read("package.json"));
  const activeDependencies = inspectPackageManifest(pkg);
  if (activeDependencies.length) {
    errors.push(`active package dependencies: ${activeDependencies.join(", ")}`);
  }

  for (const prohibited of [".lovable", "bun.lock", "bunfig.toml"]) {
    if (files.some((path) => path === prohibited || path.startsWith(`${prohibited}/`))) {
      errors.push(`prohibited tracked artifact: ${prohibited}`);
    }
  }

  if (existsSync(join(root, "package-lock.json"))) {
    const lock = JSON.parse(read("package-lock.json"));
    const staleRoot = inspectLockRoot(lock);
    const staleGraph = inspectLockGraph(lock);
    if (staleRoot.length || staleGraph.length) {
      const message = `package-lock still references removed Lovable packages: ${[
        ...new Set([...staleRoot.map((name) => `root:${name}`), ...staleGraph]),
      ].join(", ")}`;
      if (strictLock) errors.push(message);
      else warnings.push(`${message}; regenerate package-lock.json with npm before final release`);
    }
  }

  for (const path of files) {
    if (ignoredPrefixes.some((prefix) => path.startsWith(prefix))) continue;
    if (path === "package-lock.json" || scannerDefinitionFiles.has(path)) continue;
    if (!readable.has(extname(path)) && !["Dockerfile", ".env.example"].includes(path)) continue;
    const source = read(path);

    if (compatibilityRoutes.has(path)) {
      if (
        !/legacyLovableRouteGone/u.test(source) ||
        /@lovable\.dev|LOVABLE_API_KEY|success:\s*true/iu.test(source)
      ) {
        errors.push(`${path}: legacy route is not an inert 410 tombstone`);
      }
      continue;
    }

    if (path === legacyOauthRedirect) {
      if (
        !/window\.location\.replace/u.test(source) ||
        /supabase\.auth\.oauth|approveAuthorization|denyAuthorization/u.test(source)
      ) {
        errors.push(`${path}: legacy OAuth path must only redirect to /oauth/consent`);
      }
      continue;
    }

    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(source)) errors.push(`${path}: ${rule.label}`);
    }
  }

  const installedLovable = join(root, "node_modules", "@lovable.dev");
  if (existsSync(installedLovable)) errors.push("node_modules/@lovable.dev is installed");

  for (const bundleRoot of ["dist/client", "dist/server"]) {
    if (!existsSync(join(root, bundleRoot))) continue;
    for (const path of filesUnder(join(root, bundleRoot))) {
      if (!readable.has(extname(path))) continue;
      const source = readFileSync(path, "utf8");
      for (const rule of forbiddenPatterns) {
        if (rule.pattern.test(source)) {
          errors.push(`${relative(root, path).replaceAll("\\", "/")}: ${rule.label}`);
        }
      }
    }
  }

  return {
    errors: [...new Set(errors)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

function filesUnder(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = auditZeroLovable();
  for (const warning of result.warnings) console.warn(`ZERO_LOVABLE_WARNING=${warning}`);
  if (result.errors.length) {
    console.error(`Zero-Lovable audit failed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS strictLock=${strictLock} warnings=${result.warnings.length}`,
  );
}
