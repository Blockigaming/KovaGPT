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
const runtimeSourcePrefixes = ["src/", "worker/", "workers/"];
const scannerDefinitionFiles = new Set([
  "scripts/release/zero-lovable.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/security/scan-ai-runtime.mjs",
]);
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

export function hasLovableRuntimeSource(path, source = "") {
  return (
    runtimeSourcePrefixes.some((prefix) => path.startsWith(prefix)) &&
    (/lovable/iu.test(path) || /lovable/iu.test(source))
  );
}

export function hasLovableBundlePath(path) {
  return /lovable/iu.test(path);
}

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

/** Tracked-but-deleted paths must not crash the audit before the deletion is committed. */
function readIfPresent(path) {
  return existsSync(join(root, path)) ? read(path) : null;
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

export function auditZeroLovable({ files = trackedFiles() } = {}) {
  const errors = [];
  const warnings = [];
  const pkg = JSON.parse(read("package.json"));
  const activeDependencies = inspectPackageManifest(pkg);
  if (activeDependencies.length) {
    errors.push(`active package dependencies: ${activeDependencies.join(", ")}`);
  }

  for (const prohibited of [".lovable", "bun.lock", "bunfig.toml"]) {
    const tracked = files.some((path) => path === prohibited || path.startsWith(`${prohibited}/`));
    // A tracked path that no longer exists on disk is a pending deletion, not a
    // violation; only artifacts actually present in the tree fail the audit.
    if (tracked && existsSync(join(root, prohibited))) {
      errors.push(`prohibited tracked artifact: ${prohibited}`);
    }
  }

  if (existsSync(join(root, "package-lock.json"))) {
    const stale = inspectLockRoot(JSON.parse(read("package-lock.json")));
    if (stale.length) {
      const message = `package-lock root still references removed Lovable packages: ${stale.join(", ")}`;
      if (strictLock) errors.push(message);
      else warnings.push(`${message}; regenerate package-lock.json with npm before final release`);
    }
  }

  for (const path of files) {
    if (ignoredPrefixes.some((prefix) => path.startsWith(prefix))) continue;
    if (path === "package-lock.json" || scannerDefinitionFiles.has(path)) continue;
    if (hasLovableRuntimeSource(path)) {
      errors.push(`${path}: Lovable-named runtime source`);
    }
    if (!readable.has(extname(path)) && !["Dockerfile", ".env.example"].includes(path)) continue;
    const source = readIfPresent(path);
    if (source === null) continue;

    if (hasLovableRuntimeSource(path, source)) {
      errors.push(`${path}: Lovable-named runtime source`);
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
      const bundlePath = relative(root, path).replaceAll("\\", "/");
      if (hasLovableBundlePath(bundlePath)) {
        errors.push(`${bundlePath}: Lovable-named bundle asset`);
      }
      if (!readable.has(extname(path))) continue;
      const source = readFileSync(path, "utf8");
      if (/lovable/iu.test(source)) {
        errors.push(`${bundlePath}: Lovable-named bundle content`);
      }
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
