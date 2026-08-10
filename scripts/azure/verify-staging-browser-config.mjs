import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,}$/u;
const SUPABASE_URL_PATTERN = /https:\/\/([a-z0-9]{20})\.supabase\.co\b/gu;
const PUBLISHABLE_KEY_SCAN_PATTERN = /\bsb_publishable_[A-Za-z0-9_-]{16,}\b/gu;
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg"]);
const MAX_SCANNED_BYTES = 128 * 1024 * 1024;

const FORBIDDEN_SECRET_PATTERNS = [
  {
    label: "OpenAI secret key",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    label: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u,
  },
  {
    label: "PostgreSQL credential URL",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/iu,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  },
];

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSupabaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  assertCondition(raw.length > 0, "VITE_SUPABASE_URL is required for verified staging builds");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid HTTPS Supabase project URL");
  }

  assertCondition(parsed.protocol === "https:", "VITE_SUPABASE_URL must use HTTPS");
  assertCondition(
    !parsed.username && !parsed.password && !parsed.port,
    "VITE_SUPABASE_URL cannot contain credentials or a custom port",
  );
  assertCondition(
    parsed.pathname === "/" && !parsed.search && !parsed.hash,
    "VITE_SUPABASE_URL must be the project origin without a path, query, or fragment",
  );

  const hostnameMatch = /^([a-z0-9]{20})\.supabase\.co$/u.exec(parsed.hostname);
  assertCondition(
    Boolean(hostnameMatch),
    "VITE_SUPABASE_URL must use the exact <project-ref>.supabase.co hostname",
  );

  const projectRef = hostnameMatch[1];
  return {
    projectRef,
    normalizedUrl: `https://${projectRef}.supabase.co`,
  };
}

function normalizeSourceSha(value) {
  const sourceSha = typeof value === "string" ? value.trim().toLowerCase() : "";
  assertCondition(
    SOURCE_SHA_PATTERN.test(sourceSha),
    "KOVA_SOURCE_SHA must be the exact 40-character Git commit SHA",
  );
  return sourceSha;
}

function normalizePublishableKey(value) {
  const publishableKey = typeof value === "string" ? value.trim() : "";
  assertCondition(
    PUBLISHABLE_KEY_PATTERN.test(publishableKey),
    "VITE_SUPABASE_PUBLISHABLE_KEY must use the sb_publishable_ browser-safe key format",
  );
  return publishableKey;
}

function parseProjectRefs(value) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/u)
      : [];
  const refs = new Set();

  for (const candidate of candidates) {
    const projectRef = String(candidate).trim().toLowerCase();
    if (!projectRef) continue;
    assertCondition(
      PROJECT_REF_PATTERN.test(projectRef),
      "Forbidden Supabase project refs must contain exactly 20 lowercase letters or digits",
    );
    refs.add(projectRef);
  }

  return refs;
}

function readCommittedFallbackRefs(publicConfigPath) {
  if (!publicConfigPath || !existsSync(publicConfigPath)) return new Set();
  const source = readFileSync(publicConfigPath, "utf8");
  const refs = new Set();

  for (const match of source.matchAll(SUPABASE_URL_PATTERN)) refs.add(match[1]);
  return refs;
}

function isServerOnlyPath(relativePath) {
  const segments = relativePath.split(sep).map((segment) => segment.toLowerCase());
  return segments.includes("server") || segments.includes("node_modules");
}

function collectBrowserFiles(bundleDir, provenancePath) {
  const files = [];
  const root = resolve(bundleDir);
  const provenance = resolve(provenancePath);

  assertCondition(existsSync(root), `Browser bundle directory does not exist: ${bundleDir}`);

  function visit(currentPath) {
    const stat = lstatSync(currentPath);
    assertCondition(!stat.isSymbolicLink(), "Browser bundle verification refuses symbolic links");

    if (stat.isDirectory()) {
      for (const entry of readdirSync(currentPath).sort()) visit(resolve(currentPath, entry));
      return;
    }

    if (!stat.isFile() || resolve(currentPath) === provenance) return;

    const relativePath = relative(root, currentPath);
    if (isServerOnlyPath(relativePath)) return;
    if (currentPath.endsWith(".map") || !TEXT_EXTENSIONS.has(extname(currentPath).toLowerCase())) {
      return;
    }
    files.push({ absolutePath: currentPath, relativePath });
  }

  visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  assertCondition(files.length > 0, "No deployable browser text assets were found to verify");
  return files;
}

function countOccurrences(source, expected) {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = source.indexOf(expected, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + expected.length;
  }
}

export function verifyStagingBrowserConfig({
  bundleDir = process.env.KOVA_BROWSER_BUNDLE_DIR || "dist",
  supabaseUrl = process.env.VITE_SUPABASE_URL,
  publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  sourceSha = process.env.KOVA_SOURCE_SHA,
  expectedProjectRef = process.env.KOVA_EXPECTED_SUPABASE_PROJECT_REF,
  forbiddenProjectRefs = process.env.KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS,
  provenancePath,
  publicConfigPath = "src/config/public-config.ts",
  writeProvenance = true,
} = {}) {
  const { projectRef, normalizedUrl } = normalizeSupabaseUrl(supabaseUrl);
  const normalizedKey = normalizePublishableKey(publishableKey);
  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const normalizedExpectedRef = String(expectedProjectRef || projectRef)
    .trim()
    .toLowerCase();

  assertCondition(
    PROJECT_REF_PATTERN.test(normalizedExpectedRef),
    "KOVA_EXPECTED_SUPABASE_PROJECT_REF must contain exactly 20 lowercase letters or digits",
  );
  assertCondition(
    normalizedExpectedRef === projectRef,
    "The expected Supabase project ref does not match VITE_SUPABASE_URL",
  );

  const resolvedBundleDir = resolve(bundleDir);
  const resolvedProvenancePath = resolve(
    provenancePath ||
      process.env.KOVA_BROWSER_CONFIG_PROVENANCE_PATH ||
      resolve(resolvedBundleDir, "staging-browser-config-provenance.json"),
  );
  const provenanceRelativePath = relative(resolvedBundleDir, resolvedProvenancePath);
  assertCondition(
    provenanceRelativePath &&
      provenanceRelativePath !== ".." &&
      !provenanceRelativePath.startsWith(`..${sep}`),
    "Browser configuration provenance must be written inside the deployable bundle",
  );

  const forbiddenRefs = parseProjectRefs(forbiddenProjectRefs);
  for (const ref of readCommittedFallbackRefs(publicConfigPath)) forbiddenRefs.add(ref);
  forbiddenRefs.delete(projectRef);

  const browserFiles = collectBrowserFiles(resolvedBundleDir, resolvedProvenancePath);
  const bundleHash = createHash("sha256");
  const discoveredProjectRefs = new Set();
  const discoveredPublishableKeys = new Set();
  let scannedBytes = 0;
  let expectedUrlOccurrences = 0;
  let expectedKeyOccurrences = 0;

  for (const file of browserFiles) {
    const bytes = readFileSync(file.absolutePath);
    scannedBytes += bytes.byteLength;
    assertCondition(
      scannedBytes <= MAX_SCANNED_BYTES,
      "Browser configuration scan exceeded the 128 MiB safety limit",
    );

    const text = bytes.toString("utf8");
    expectedUrlOccurrences += countOccurrences(text, normalizedUrl);
    expectedKeyOccurrences += countOccurrences(text, normalizedKey);

    for (const match of text.matchAll(SUPABASE_URL_PATTERN)) discoveredProjectRefs.add(match[1]);
    for (const match of text.matchAll(PUBLISHABLE_KEY_SCAN_PATTERN)) {
      discoveredPublishableKeys.add(match[0]);
    }

    for (const forbidden of FORBIDDEN_SECRET_PATTERNS) {
      assertCondition(
        !forbidden.pattern.test(text),
        `${forbidden.label} was detected in browser asset ${file.relativePath}`,
      );
    }

    const fileHash = sha256(bytes);
    bundleHash.update(file.relativePath);
    bundleHash.update("\0");
    bundleHash.update(fileHash);
    bundleHash.update("\0");
  }

  assertCondition(
    expectedUrlOccurrences > 0,
    "The intended Supabase URL was not found in deployable browser assets",
  );
  assertCondition(
    expectedKeyOccurrences > 0,
    "The intended Supabase publishable key was not found in deployable browser assets",
  );

  const unexpectedRefs = [...discoveredProjectRefs].filter((ref) => ref !== projectRef);
  assertCondition(
    unexpectedRefs.length === 0,
    `Unexpected Supabase project refs were detected in browser assets: ${unexpectedRefs.join(", ")}`,
  );

  const explicitlyForbiddenRefs = [...discoveredProjectRefs].filter((ref) => forbiddenRefs.has(ref));
  assertCondition(
    explicitlyForbiddenRefs.length === 0,
    `Forbidden Supabase project refs were detected in browser assets: ${explicitlyForbiddenRefs.join(", ")}`,
  );

  const unexpectedPublishableKeyCount = [...discoveredPublishableKeys].filter(
    (key) => key !== normalizedKey,
  ).length;
  assertCondition(
    unexpectedPublishableKeyCount === 0,
    "An unexpected Supabase publishable key was detected in browser assets",
  );

  const provenance = {
    schemaVersion: 1,
    verification: "verified-build-time-browser-config",
    sourceSha: normalizedSourceSha,
    supabaseProjectRef: projectRef,
    supabaseUrl: normalizedUrl,
    publishableKeySha256: sha256(normalizedKey),
    browserBundleSha256: bundleHash.digest("hex"),
    scannedFiles: browserFiles.length,
    scannedBytes,
    expectedUrlOccurrences,
    expectedKeyOccurrences,
    discoveredSupabaseProjectRefs: [...discoveredProjectRefs].sort(),
    forbiddenProjectRefsChecked: [...forbiddenRefs].sort(),
  };

  if (writeProvenance) {
    mkdirSync(dirname(resolvedProvenancePath), { recursive: true });
    writeFileSync(resolvedProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`, {
      mode: 0o644,
    });
  }

  return {
    provenance,
    provenancePath: resolvedProvenancePath,
    browserFiles: browserFiles.map((file) => file.relativePath),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = verifyStagingBrowserConfig();
    console.log(`STAGING_BROWSER_CONFIG_PROJECT_REF=${result.provenance.supabaseProjectRef}`);
    console.log(`STAGING_BROWSER_BUNDLE_SHA256=${result.provenance.browserBundleSha256}`);
    console.log(`STAGING_BROWSER_CONFIG_PROVENANCE=${result.provenancePath}`);
  } catch (error) {
    console.error(
      `STAGING_BROWSER_CONFIG_VERIFICATION_FAILED=${
        error instanceof Error ? error.message : "unknown verification failure"
      }`,
    );
    process.exit(1);
  }
}
