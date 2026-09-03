import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { TextDecoder } from "node:util";

const root = process.cwd();
const strictLock = process.argv.includes("--strict-lock");
const requireBuild = process.argv.includes("--require-build");
const readable = new Set([
  ".bicep",
  ".cjs",
  ".conf",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".sh",
  ".map",
  ".sql",
  ".svg",
  ".toml",
  ".txt",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const readableBundleBasenames = new Set(["_headers", "_redirects"]);
const ignoredPrefixes = ["artifacts/", "docs/", "tests/"];
const runtimeSourcePrefixes = ["src/", "worker/", "workers/"];
const productionInputPrefixes = ["supabase/"];
const activeControlPrefixes = [".github/", "infra/", "public/", "scripts/"];
const activeRootInputs = new Set([
  ".dockerignore",
  ".env.example",
  "Dockerfile",
  "docker-compose.agent.yml",
  "vite.config.ts",
  "wrangler.jsonc",
]);
const scannerDefinitionFiles = new Set([
  "scripts/release/zero-lovable.mjs",
  "scripts/release/ai-provider-contract.mjs",
  "scripts/security/scan-ai-runtime.mjs",
  "scripts/azure/validate-staging-template.mjs",
  "scripts/release/artifact-secret-scan.mjs",
]);
const guardReferenceFiles = new Set([
  "scripts/release/final-evidence.mjs",
  "scripts/release/finalize-local-candidate.sh",
  "scripts/release/local-non-actions-gate.mjs",
]);
const allowedGateScriptNames = new Set([
  "release:zero-lovable",
  "release:zero-lovable:strict",
  "release:zero-lovable:built",
]);
const allowedGateReference =
  /release:zero-lovable(?::(?:strict|built))?|scripts\/release\/zero-lovable\.mjs|zero-lovable(?:-(?:strict|built))?|zeroLovable(?:Source|Image|Network)/giu;
const currentZeroLovableDocs = new Set([
  "docs/azure-staging-validation-status.md",
  "docs/azure/DEPLOYMENT_CHECKLIST.md",
  "docs/openai-runtime.md",
  "docs/release/KOVAGPT_MANUAL_HANDOFF.md",
  "docs/release-reconciliation/zero-lovable-classification.md",
]);
const historicalDocMarker = /> \*\*Historical and superseded \(\d{4}-\d{2}-\d{2}\):\*\*/u;
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

export function isDockerfilePath(path) {
  return /(?:^|\.)dockerfile(?:\.|$)/iu.test(basename(path));
}

export function hasLovableProductionInput(path, source = "") {
  return (
    (productionInputPrefixes.some((prefix) => path.startsWith(prefix)) || isDockerfilePath(path)) &&
    (/lovable/iu.test(path) || /lovable/iu.test(source))
  );
}

export function hasLovableBundlePath(path) {
  return /lovable/iu.test(path);
}

export function hasReadableBundleContent(path) {
  return readable.has(extname(path).toLowerCase()) || readableBundleBasenames.has(basename(path));
}

export function hasReadableRuntimeContent(path) {
  return (
    hasReadableBundleContent(path) || basename(path) === ".env.example" || isDockerfilePath(path)
  );
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeReadableText(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let source;

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const body = buffer.subarray(2);
    if (body.length % 2 !== 0) throw new Error("truncated UTF-16LE text");
    source = body.toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2));
    if (body.length % 2 !== 0) throw new Error("truncated UTF-16BE text");
    for (let index = 0; index < body.length; index += 2) {
      const first = body[index];
      body[index] = body[index + 1];
      body[index + 1] = first;
    }
    source = body.toString("utf16le");
  } else {
    source = utf8Decoder.decode(buffer);
  }

  if (source.includes("\0")) throw new Error("NUL-containing text");
  return source;
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
  return decodeReadableText(readFileSync(join(root, path)));
}

function readForAudit(filePath, displayPath, errors) {
  try {
    return decodeReadableText(readFileSync(filePath));
  } catch {
    errors.push(`${displayPath}: unsupported or NUL-containing text encoding`);
    return null;
  }
}

/** Tracked-but-deleted paths must not crash the audit before the deletion is committed. */
function readIfPresent(path, errors) {
  return existsSync(join(root, path)) ? readForAudit(join(root, path), path, errors) : null;
}

export function inspectPackageManifest(pkg) {
  const groups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  return groups.flatMap((group) =>
    Object.keys(pkg[group] ?? {})
      .filter((name) => /lovable/iu.test(name))
      .map((name) => `${group}:${name}`),
  );
}

export function inspectPackageScripts(pkg) {
  return Object.entries(pkg.scripts ?? {}).flatMap(([name, command]) => {
    const hasUnexpectedName = /lovable/iu.test(name) && !allowedGateScriptNames.has(name);
    const remainingCommand = String(command).replace(allowedGateReference, "");
    return hasUnexpectedName || /lovable/iu.test(remainingCommand) ? [name] : [];
  });
}

export function inspectPackageMetadata(pkg) {
  const metadata = { ...pkg };
  delete metadata.scripts;
  delete metadata.dependencies;
  delete metadata.devDependencies;
  delete metadata.optionalDependencies;
  delete metadata.peerDependencies;
  return /lovable/iu.test(JSON.stringify(metadata)) ? ["package metadata"] : [];
}

export function inspectLockRoot(lock) {
  return Object.keys(lock.packages?.[""]?.dependencies ?? {}).filter((name) =>
    /lovable/iu.test(name),
  );
}

export function inspectLockfile(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(
      ([path, metadata]) => /lovable/iu.test(path) || /lovable/iu.test(JSON.stringify(metadata)),
    )
    .map(([path]) => path || "<root>");
}

export function hasLovableActiveControl(path, source = "") {
  const active =
    runtimeSourcePrefixes.some((prefix) => path.startsWith(prefix)) ||
    productionInputPrefixes.some((prefix) => path.startsWith(prefix)) ||
    activeControlPrefixes.some((prefix) => path.startsWith(prefix)) ||
    activeRootInputs.has(path) ||
    isDockerfilePath(path);
  if (!active || scannerDefinitionFiles.has(path)) return false;
  const auditedSource = guardReferenceFiles.has(path)
    ? source.replace(allowedGateReference, "")
    : source;
  return /lovable/iu.test(path) || /lovable/iu.test(auditedSource);
}

export function hasUnclassifiedLovableDocumentation(path, source = "") {
  if (!path.startsWith("docs/") || !path.endsWith(".md") || !/lovable/iu.test(source)) return false;
  return !currentZeroLovableDocs.has(path) && !historicalDocMarker.test(source.slice(0, 1_000));
}

export function auditZeroLovable({ files = trackedFiles() } = {}) {
  const errors = [];
  const warnings = [];
  const pkg = JSON.parse(read("package.json"));
  const activeDependencies = inspectPackageManifest(pkg);
  if (activeDependencies.length) {
    errors.push(`active package dependencies: ${activeDependencies.join(", ")}`);
  }
  const activeScripts = inspectPackageScripts(pkg);
  if (activeScripts.length) errors.push(`active package scripts: ${activeScripts.join(", ")}`);
  const activeMetadata = inspectPackageMetadata(pkg);
  if (activeMetadata.length) errors.push(`active package metadata: ${activeMetadata.join(", ")}`);

  for (const prohibited of [".lovable", "bun.lock", "bunfig.toml"]) {
    const tracked = files.some((path) => path === prohibited || path.startsWith(`${prohibited}/`));
    // A tracked path that no longer exists on disk is a pending deletion, not a
    // violation; only artifacts actually present in the tree fail the audit.
    if (tracked && existsSync(join(root, prohibited))) {
      errors.push(`prohibited tracked artifact: ${prohibited}`);
    }
  }

  if (existsSync(join(root, "package-lock.json"))) {
    const lock = JSON.parse(read("package-lock.json"));
    const stale = inspectLockRoot(lock);
    if (stale.length) {
      const message = `package-lock root still references removed Lovable packages: ${stale.join(", ")}`;
      if (strictLock) errors.push(message);
      else warnings.push(`${message}; regenerate package-lock.json with npm before final release`);
    }
    const lockHits = inspectLockfile(lock);
    if (lockHits.length) {
      errors.push(`package-lock contains Lovable package or metadata: ${lockHits.join(", ")}`);
    }
  }

  for (const path of files) {
    if (path.startsWith("docs/") && path.endsWith(".md") && existsSync(join(root, path))) {
      const source = readIfPresent(path, errors);
      if (source !== null && hasUnclassifiedLovableDocumentation(path, source)) {
        errors.push(`${path}: Lovable history is not explicitly classified`);
      }
    }
    if (ignoredPrefixes.some((prefix) => path.startsWith(prefix))) continue;
    if (path === "package-lock.json" || scannerDefinitionFiles.has(path)) continue;
    if (!existsSync(join(root, path))) continue;
    if (hasLovableRuntimeSource(path)) {
      errors.push(`${path}: Lovable-named runtime source`);
    }
    if (hasLovableProductionInput(path)) {
      errors.push(`${path}: Lovable-named production input`);
    }
    if (hasLovableActiveControl(path)) {
      errors.push(`${path}: Lovable reference in active source or control plane`);
    }
    if (!hasReadableRuntimeContent(path)) continue;
    const source = readIfPresent(path, errors);
    if (source === null) continue;

    if (hasLovableRuntimeSource(path, source)) {
      errors.push(`${path}: Lovable-named runtime source`);
    }
    if (hasLovableProductionInput(path, source)) {
      errors.push(`${path}: Lovable-named production input`);
    }
    if (hasLovableActiveControl(path, source)) {
      errors.push(`${path}: Lovable reference in active source or control plane`);
    }

    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(source)) errors.push(`${path}: ${rule.label}`);
    }
  }

  const installedLovable = join(root, "node_modules", "@lovable.dev");
  if (existsSync(installedLovable)) errors.push("node_modules/@lovable.dev is installed");

  const bundleRoot = "dist";
  let bundleFiles = 0;
  let sourceMaps = 0;
  if (!existsSync(join(root, bundleRoot))) {
    if (requireBuild) errors.push(`${bundleRoot}: built output is required`);
  } else {
    for (const path of filesUnder(join(root, bundleRoot))) {
      bundleFiles += 1;
      if (extname(path).toLowerCase() === ".map") sourceMaps += 1;
      const bundlePath = relative(root, path).replaceAll("\\", "/");
      if (hasLovableBundlePath(bundlePath)) {
        errors.push(`${bundlePath}: Lovable-named bundle asset`);
      }
      if (!hasReadableBundleContent(path)) continue;
      const source = readForAudit(path, bundlePath, errors);
      if (source === null) continue;
      if (/lovable/iu.test(source)) {
        errors.push(`${bundlePath}: Lovable-named bundle content`);
      }
      for (const rule of forbiddenPatterns) {
        if (rule.pattern.test(source)) {
          errors.push(`${bundlePath}: ${rule.label}`);
        }
      }
    }
  }

  return {
    errors: [...new Set(errors)].sort(),
    warnings: [...new Set(warnings)].sort(),
    evidence: { bundleFiles, sourceMaps },
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
    `ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS strictLock=${strictLock} requireBuild=${requireBuild} bundleFiles=${result.evidence.bundleFiles} sourceMaps=${result.evidence.sourceMaps} warnings=${result.warnings.length}`,
  );
}
