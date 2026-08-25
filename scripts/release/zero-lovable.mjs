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
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const ignoredPrefixes = ["artifacts/", "docs/", "tests/"];
const scannerDefinitionFiles = new Set([
  "scripts/release/zero-lovable.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/release/architecture-contract.mjs",
  "scripts/release/production-system-verifier.mjs",
  "scripts/security/scan-ai-runtime.mjs",
]);
const forbiddenPatterns = [
  { label: "Lovable SDK import", pattern: /@lovable\.dev\//iu },
  {
    label: "Lovable hosted runtime",
    pattern:
      /(?:ai|connector)-gateway\.lovable\.dev|(?:^|[^a-z])lovable\.(?:app|dev)(?:[^a-z]|$)/iu,
  },
  {
    label: "Lovable credential or runtime variable",
    pattern: /\b(?:VITE_)?LOVABLE_[A-Z0-9_]+\b|Lovable-API-Key/iu,
  },
  {
    label: "Lovable billing metadata dependency",
    pattern: /lovable_(?:external_id|managed)/iu,
  },
  {
    label: "Lovable runtime route",
    pattern:
      /create(?:Root)?FileRoute\(["']\/(?:\.?lovable)(?:\/|["'])|["']\/(?:\.?lovable)(?:\/|["'])/iu,
  },
];
const forbiddenBuiltRoute = /(?:\/|\\u002f)(?:\.?lovable)(?:\/|\\u002f|["'])/iu;

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
      .filter((path) => existsSync(join(root, path)));
  } catch {
    const files = [];
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        if ([".git", "node_modules", "dist"].includes(name)) continue;
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
  const rootPackage = lock.packages?.[""] ?? {};
  return [
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...Object.keys(rootPackage.devDependencies ?? {}),
    ...Object.keys(rootPackage.optionalDependencies ?? {}),
  ].filter((name) => /lovable/iu.test(name));
}

function isIgnored(path) {
  return ignoredPrefixes.some((prefix) => path.startsWith(prefix));
}

function isForbiddenActivePath(path) {
  if (scannerDefinitionFiles.has(path) || isIgnored(path)) return false;
  return /(?:^|\/)lovable(?:\/|\.|$)|(?:^|\/)\[\.\]lovable\./iu.test(path);
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

  for (const path of files.filter(isForbiddenActivePath)) {
    errors.push(`${path}: prohibited active Lovable path`);
  }

  if (existsSync(join(root, "package-lock.json"))) {
    const stale = inspectLockRoot(JSON.parse(read("package-lock.json")));
    if (stale.length) {
      const message = `package-lock root still references removed Lovable packages: ${[
        ...new Set(stale),
      ].join(", ")}`;
      if (strictLock) errors.push(message);
      else warnings.push(`${message}; regenerate package-lock.json with npm before final release`);
    }
  }

  for (const path of files) {
    if (isIgnored(path) || path === "package-lock.json" || scannerDefinitionFiles.has(path))
      continue;
    if (!readable.has(extname(path)) && !["Dockerfile", ".env.example"].includes(path)) continue;
    const source = read(path);
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
      const relativePath = relative(root, path).replaceAll("\\", "/");
      for (const rule of forbiddenPatterns) {
        if (rule.pattern.test(source)) errors.push(`${relativePath}: ${rule.label}`);
      }
      if (forbiddenBuiltRoute.test(source) || /lovable\.oauth/iu.test(relativePath)) {
        errors.push(`${relativePath}: Lovable route emitted in production build`);
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
  if (!existsSync(directory)) return files;
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
