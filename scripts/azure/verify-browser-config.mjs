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
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40}$/u;
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,}$/u;
const SUPABASE_URL_PATTERN = /https:\/\/([a-z0-9]{20})\.supabase\.co\b/giu;
const PUBLISHABLE_KEY_SCAN_PATTERN = /\bsb_publishable_[A-Za-z0-9_-]{16,}\b/gu;
const JWT_CANDIDATE_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".pem",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);
const EXECUTABLE_BROWSER_EXTENSIONS = new Set([".js", ".mjs"]);
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
    label: "Stripe secret key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  },
  {
    label: "Stripe webhook signing secret",
    pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/u,
  },
  {
    label: "PostgreSQL credential URL",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/iu,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:[A-Z0-9][A-Z0-9 -]* )?PRIVATE KEY-----/u,
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
  assertCondition(raw.length > 0, "VITE_SUPABASE_URL is required for verified candidate builds");

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

function normalizeGitObject(value, variableName) {
  const gitObject = typeof value === "string" ? value.trim().toLowerCase() : "";
  assertCondition(
    GIT_OBJECT_PATTERN.test(gitObject),
    `${variableName} must be an exact 40-character Git object identifier`,
  );
  return gitObject;
}

function normalizeSourceSha(value) {
  return normalizeGitObject(value, "KOVA_SOURCE_SHA");
}

function normalizeSourceTree(value) {
  return normalizeGitObject(value, "KOVA_SOURCE_TREE");
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

  for (const match of source.matchAll(SUPABASE_URL_PATTERN)) refs.add(match[1].toLowerCase());
  return refs;
}

function assertNoLegacySupabaseJwt(text, expectedProjectRef, relativePath) {
  for (const match of text.matchAll(JWT_CANDIDATE_PATTERN)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"));
    } catch {
      continue;
    }

    if (!payload || typeof payload !== "object") continue;

    const role = typeof payload.role === "string" ? payload.role : "";
    const claimedRef = typeof payload.ref === "string" ? payload.ref.trim().toLowerCase() : "";
    const looksLikeSupabaseJwt =
      role === "anon" || role === "authenticated" || role === "service_role" || claimedRef !== "";
    if (!looksLikeSupabaseJwt) continue;

    if (role === "service_role") {
      throw new Error(`Supabase service-role JWT detected in browser asset ${relativePath}`);
    }

    if (role === "anon") {
      assertCondition(
        PROJECT_REF_PATTERN.test(claimedRef),
        `Legacy Supabase anon JWT without a valid project ref detected in browser asset ${relativePath}`,
      );
      assertCondition(
        claimedRef === expectedProjectRef,
        `Legacy Supabase anon JWT for an unexpected project detected in browser asset ${relativePath}`,
      );
      throw new Error(
        `Legacy Supabase anon JWT detected in browser asset ${relativePath}; verified candidates require the approved publishable key`,
      );
    }

    throw new Error(`Non-publishable Supabase JWT detected in browser asset ${relativePath}`);
  }
}

function readSourceAttestation(path, expectedSourceSha, expectedSourceTree) {
  const attestationPath = typeof path === "string" ? path.trim() : "";
  assertCondition(
    attestationPath,
    "KOVA_SOURCE_ATTESTATION_PATH is required for a verified browser image",
  );
  assertCondition(
    existsSync(attestationPath),
    "The verified Git-archive source attestation is missing",
  );

  let attestation;
  try {
    attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
  } catch {
    throw new Error("The verified Git-archive source attestation is invalid");
  }

  assertCondition(
    attestation?.schemaVersion === 1 && ["git-archive", "acr-git"].includes(attestation?.context),
    "The source attestation must identify an approved versioned source context",
  );

  const sourceSha = normalizeSourceSha(attestation.sourceSha);
  const sourceTree = normalizeSourceTree(attestation.sourceTree);
  assertCondition(
    sourceSha === expectedSourceSha,
    "The source attestation commit does not match KOVA_SOURCE_SHA",
  );
  assertCondition(
    sourceTree === expectedSourceTree,
    "The source attestation tree does not match KOVA_SOURCE_TREE",
  );

  return {
    context: attestation.context,
    sourceSha,
    sourceTree,
  };
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
    const extension = extname(currentPath).toLowerCase();
    if (currentPath.endsWith(".map") || !TEXT_EXTENSIONS.has(extension)) return;
    files.push({
      absolutePath: currentPath,
      relativePath,
      executable: EXECUTABLE_BROWSER_EXTENSIONS.has(extension),
    });
  }

  visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  assertCondition(files.length > 0, "No deployable browser text assets were found to verify");
  assertCondition(
    files.some((file) => file.executable),
    "No executable browser assets were found to verify",
  );
  return files;
}

function decodeBrowserText(bytes, relativePath) {
  let encoding = "utf-8";
  let offset = 0;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  }

  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw new Error(`Browser text asset ${relativePath} must be valid UTF-8 or BOM-marked UTF-16`);
  }

  assertCondition(
    !(encoding === "utf-8" && text.includes("\0")),
    `Browser text asset ${relativePath} contains NUL bytes without a supported text BOM`,
  );
  return text;
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

export function verifyBrowserConfig({
  bundleDir = process.env.KOVA_BROWSER_BUNDLE_DIR || "dist/client",
  supabaseUrl = process.env.VITE_SUPABASE_URL,
  publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  stripePublishableKey = process.env.VITE_PAYMENTS_CLIENT_TOKEN || "",
  sourceSha = process.env.KOVA_SOURCE_SHA,
  sourceTree = process.env.KOVA_SOURCE_TREE,
  sourceAttestationPath = process.env.KOVA_SOURCE_ATTESTATION_PATH,
  expectedProjectRef = process.env.KOVA_EXPECTED_SUPABASE_PROJECT_REF,
  forbiddenProjectRefs = process.env.KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS,
  provenancePath,
  publicConfigPath = "src/config/public-config.ts",
  writeProvenance = true,
} = {}) {
  const { projectRef, normalizedUrl } = normalizeSupabaseUrl(supabaseUrl);
  const normalizedKey = normalizePublishableKey(publishableKey);
  const stripeKey = String(stripePublishableKey);
  assertCondition(
    stripeKey === "" || /^pk_(?:live|test)_[A-Za-z0-9]{16,}$/u.test(stripeKey),
    "The optional Stripe browser key must be a publishable key",
  );
  let stripeExecutableOccurrences = 0;
  const discoveredStripeKeys = new Set();
  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const normalizedSourceTree = normalizeSourceTree(sourceTree);
  const sourceAttestation = readSourceAttestation(
    sourceAttestationPath,
    normalizedSourceSha,
    normalizedSourceTree,
  );
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
      resolve(resolvedBundleDir, "..", "browser-config-provenance.json"),
  );
  const provenanceRelativePath = relative(resolvedBundleDir, resolvedProvenancePath);
  assertCondition(
    provenanceRelativePath === ".." || provenanceRelativePath.startsWith(`..${sep}`),
    "Browser configuration provenance must be written outside the public browser directory",
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
  let executableExpectedUrlOccurrences = 0;
  let executableExpectedKeyOccurrences = 0;

  for (const file of browserFiles) {
    const bytes = readFileSync(file.absolutePath);
    scannedBytes += bytes.byteLength;
    assertCondition(
      scannedBytes <= MAX_SCANNED_BYTES,
      "Browser configuration scan exceeded the 128 MiB safety limit",
    );

    const text = decodeBrowserText(bytes, file.relativePath);
    const lowerText = text.toLowerCase();
    const urlOccurrences = countOccurrences(text, normalizedUrl);
    const keyOccurrences = countOccurrences(text, normalizedKey);
    expectedUrlOccurrences += urlOccurrences;
    expectedKeyOccurrences += keyOccurrences;
    if (file.executable) {
      executableExpectedUrlOccurrences += urlOccurrences;
      executableExpectedKeyOccurrences += keyOccurrences;
      if (stripeKey) stripeExecutableOccurrences += countOccurrences(text, stripeKey);
    }

    for (const match of text.matchAll(SUPABASE_URL_PATTERN)) {
      discoveredProjectRefs.add(match[1].toLowerCase());
    }
    for (const match of text.matchAll(/\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/gu)) {
      discoveredStripeKeys.add(match[0]);
    }
    for (const match of text.matchAll(PUBLISHABLE_KEY_SCAN_PATTERN)) {
      discoveredPublishableKeys.add(match[0]);
    }

    for (const forbiddenRef of forbiddenRefs) {
      assertCondition(
        !lowerText.includes(forbiddenRef),
        `Forbidden Supabase project-ref literal detected in browser asset ${file.relativePath}`,
      );
    }

    assertNoLegacySupabaseJwt(text, projectRef, file.relativePath);

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
    executableExpectedUrlOccurrences > 0,
    "The intended Supabase URL was not found in executable browser assets",
  );
  assertCondition(
    executableExpectedKeyOccurrences > 0,
    "The intended Supabase publishable key was not found in executable browser assets",
  );

  const unexpectedRefs = [...discoveredProjectRefs].filter((ref) => ref !== projectRef);
  assertCondition(
    unexpectedRefs.length === 0,
    `Unexpected Supabase project refs were detected in browser assets: ${unexpectedRefs.join(", ")}`,
  );

  const explicitlyForbiddenRefs = [...discoveredProjectRefs].filter((ref) =>
    forbiddenRefs.has(ref),
  );
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

  assertCondition(
    [...discoveredStripeKeys].every((key) => key === stripeKey),
    "An unexpected Stripe publishable key was detected in browser assets",
  );
  assertCondition(
    !stripeKey || stripeExecutableOccurrences > 0,
    "The intended Stripe publishable key was not found in executable browser assets",
  );

  const provenance = {
    schemaVersion: 3,
    verification: "verified-build-time-browser-config",
    sourceSha: normalizedSourceSha,
    sourceTree: normalizedSourceTree,
    sourceContext: sourceAttestation.context,
    supabaseProjectRef: projectRef,
    supabaseUrl: normalizedUrl,
    publishableKeySha256: sha256(normalizedKey),
    stripePublishableKeySha256: stripeKey ? sha256(stripeKey) : null,
    browserBundleSha256: bundleHash.digest("hex"),
    scannedFiles: browserFiles.length,
    executableFiles: browserFiles.filter((file) => file.executable).length,
    scannedBytes,
    expectedUrlOccurrences,
    expectedKeyOccurrences,
    executableExpectedUrlOccurrences,
    executableExpectedKeyOccurrences,
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
    const result = verifyBrowserConfig();
    console.log(`BROWSER_CONFIG_PROJECT_REF=${result.provenance.supabaseProjectRef}`);
    console.log(`BROWSER_BUNDLE_SHA256=${result.provenance.browserBundleSha256}`);
    console.log(`BROWSER_CONFIG_PROVENANCE=${result.provenancePath}`);
  } catch (error) {
    console.error(
      `BROWSER_CONFIG_VERIFICATION_FAILED=${
        error instanceof Error ? error.message : "unknown verification failure"
      }`,
    );
    process.exit(1);
  }
}
