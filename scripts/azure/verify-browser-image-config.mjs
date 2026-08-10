import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_ASSET_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,}$/u;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const OPENAI_SECRET_PATTERN = /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u;
const SUPABASE_SECRET_PATTERN = /\bsb_secret_[A-Za-z0-9_-]{20,}\b/u;
const DATABASE_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u;
const SUPABASE_HOST_PATTERN = /https:\/\/([a-z0-9]{20})\.supabase\.co(?:\/)?/giu;
const JWT_CANDIDATE_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;

function countOccurrences(source, value) {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(value, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + value.length;
  }
}

function decodeJwtPayload(value) {
  if (!JWT_PATTERN.test(value)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function normalizeProjectRef(value) {
  const projectRef = String(value ?? "").trim();
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error("Browser Supabase project ref must be exactly 20 lowercase letters or digits.");
  }
  return projectRef;
}

function normalizeSourceSha(value) {
  const sourceSha = String(value ?? "").trim();
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    throw new Error("Source SHA must be a complete 40-character Git commit SHA.");
  }
  return sourceSha.toLowerCase();
}

function normalizeSupabaseUrl(value, projectRef) {
  const raw = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Browser Supabase URL is invalid.");
  }

  const canonical = `https://${projectRef}.supabase.co`;
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== `${projectRef}.supabase.co` ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (raw !== canonical && raw !== `${canonical}/`)
  ) {
    throw new Error("Browser Supabase URL must be the canonical HTTPS root for the project ref.");
  }
  return canonical;
}

function validatePublishableKey(value, projectRef) {
  const key = String(value ?? "").trim();
  if (PUBLISHABLE_KEY_PATTERN.test(key)) return key;

  const payload = decodeJwtPayload(key);
  if (
    payload?.role === "anon" &&
    (typeof payload.ref === "undefined" || payload.ref === projectRef)
  ) {
    return key;
  }

  throw new Error(
    "Browser Supabase key must be a publishable key or an anon JWT for this project.",
  );
}

function normalizeForbiddenRefs(value, expectedProjectRef) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  const refs = [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))].sort();
  for (const ref of refs) {
    if (!PROJECT_REF_PATTERN.test(ref)) {
      throw new Error("Every forbidden Supabase project ref must use the 20-character ref format.");
    }
    if (ref === expectedProjectRef) {
      throw new Error("The expected browser project cannot also be configured as forbidden.");
    }
  }
  return refs;
}

async function collectTextAssets(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Browser asset verification refuses symbolic links.");
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && TEXT_ASSET_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  await visit(root);
  return files;
}

function rejectServiceRoleJwtCandidates(source) {
  for (const match of source.matchAll(JWT_CANDIDATE_PATTERN)) {
    const payload = decodeJwtPayload(match[0]);
    if (payload?.role === "service_role" || payload?.role === "supabase_admin") {
      throw new Error("Browser bundle contains a privileged Supabase JWT.");
    }
  }
}

function rejectSecretMaterial(source) {
  if (OPENAI_SECRET_PATTERN.test(source)) {
    throw new Error("Browser bundle contains material matching an OpenAI secret key.");
  }
  if (SUPABASE_SECRET_PATTERN.test(source)) {
    throw new Error("Browser bundle contains material matching a Supabase secret key.");
  }
  if (DATABASE_URL_PATTERN.test(source)) {
    throw new Error("Browser bundle contains a PostgreSQL connection URL.");
  }
  if (PRIVATE_KEY_PATTERN.test(source)) {
    throw new Error("Browser bundle contains private-key PEM material.");
  }

  rejectServiceRoleJwtCandidates(source);
}

export async function verifyBrowserImageConfig({
  assetRoot,
  outputPath,
  sourceSha,
  projectRef,
  supabaseUrl,
  publishableKey,
  forbiddenProjectRefs = [],
}) {
  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const normalizedProjectRef = normalizeProjectRef(projectRef);
  const normalizedUrl = normalizeSupabaseUrl(supabaseUrl, normalizedProjectRef);
  const normalizedKey = validatePublishableKey(publishableKey, normalizedProjectRef);
  const forbiddenRefs = normalizeForbiddenRefs(forbiddenProjectRefs, normalizedProjectRef);
  const root = path.resolve(String(assetRoot ?? ""));
  const assets = await collectTextAssets(root);

  if (assets.length === 0) {
    throw new Error("No deployable browser text assets were found for verification.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bundleHash = createHash("sha256");
  const discoveredProjectRefs = new Set();
  let byteCount = 0;
  let expectedUrlOccurrences = 0;
  let expectedKeyOccurrences = 0;

  for (const absolutePath of assets) {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    const bytes = await readFile(absolutePath);
    let source;
    try {
      source = decoder.decode(bytes);
    } catch {
      throw new Error(`Browser asset is not valid UTF-8: ${relativePath}`);
    }

    bundleHash.update(relativePath);
    bundleHash.update("\0");
    bundleHash.update(bytes);
    bundleHash.update("\0");
    byteCount += bytes.byteLength;
    expectedUrlOccurrences += countOccurrences(source, normalizedUrl);
    expectedKeyOccurrences += countOccurrences(source, normalizedKey);

    rejectSecretMaterial(source);

    for (const match of source.matchAll(SUPABASE_HOST_PATTERN)) {
      const discoveredRef = match[1].toLowerCase();
      discoveredProjectRefs.add(discoveredRef);
      if (discoveredRef !== normalizedProjectRef) {
        throw new Error(
          `Browser bundle references an unexpected Supabase project: ${discoveredRef}`,
        );
      }
    }
    SUPABASE_HOST_PATTERN.lastIndex = 0;

    for (const forbiddenRef of forbiddenRefs) {
      if (source.includes(forbiddenRef)) {
        throw new Error(
          `Browser bundle contains a forbidden Supabase project ref: ${forbiddenRef}`,
        );
      }
    }
  }

  if (expectedUrlOccurrences === 0) {
    throw new Error("Expected synthetic Supabase URL was not found in deployable browser assets.");
  }
  if (expectedKeyOccurrences === 0) {
    throw new Error(
      "Expected synthetic Supabase publishable key was not found in deployable browser assets.",
    );
  }
  if (!discoveredProjectRefs.has(normalizedProjectRef)) {
    throw new Error(
      "Expected synthetic Supabase hostname was not discovered in deployable browser assets.",
    );
  }

  const provenance = {
    schemaVersion: 1,
    sourceSha: normalizedSourceSha,
    browserSupabaseProjectRef: normalizedProjectRef,
    browserSupabaseUrl: normalizedUrl,
    publishableKeyFingerprint: `sha256:${createHash("sha256").update(normalizedKey).digest("hex")}`,
    browserBundleDigest: `sha256:${bundleHash.digest("hex")}`,
    scan: {
      fileCount: assets.length,
      byteCount,
      expectedUrlOccurrences,
      expectedKeyOccurrences,
      discoveredSupabaseProjectRefs: [...discoveredProjectRefs].sort(),
      configuredForbiddenProjectRefCount: forbiddenRefs.length,
    },
  };

  const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
  if (serialized.includes(normalizedKey)) {
    throw new Error("Provenance serialization unexpectedly contained the publishable key.");
  }

  if (outputPath) {
    const resolvedOutput = path.resolve(String(outputPath));
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, serialized, "utf8");
  }

  return provenance;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.env.KOVA_VERIFY_BROWSER_CONFIG !== "true") {
    console.log("KOVA_BROWSER_CONFIG_VERIFICATION=disabled");
  } else {
    const provenance = await verifyBrowserImageConfig({
      assetRoot: process.env.KOVA_BROWSER_ASSET_ROOT || "dist/client",
      outputPath:
        process.env.KOVA_BROWSER_CONFIG_PROVENANCE_PATH || "dist/browser-config-provenance.json",
      sourceSha: process.env.KOVA_SOURCE_SHA,
      projectRef: process.env.KOVA_BROWSER_SUPABASE_PROJECT_REF,
      supabaseUrl: process.env.VITE_SUPABASE_URL,
      publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      forbiddenProjectRefs: process.env.KOVA_FORBIDDEN_SUPABASE_REFS,
    });
    console.log(
      `KOVA_BROWSER_CONFIG_VERIFICATION=${JSON.stringify({
        sourceSha: provenance.sourceSha,
        projectRef: provenance.browserSupabaseProjectRef,
        bundleDigest: provenance.browserBundleDigest,
        fileCount: provenance.scan.fileCount,
      })}`,
    );
  }
}
