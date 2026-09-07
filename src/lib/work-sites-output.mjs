import { inspectSiteFiles, sha256, sitePath, siteUuid } from "./sites-policy.mjs";

export const WORK_SITE_BUNDLE_SCHEMA = "kova-work-site-v1";
export const WORK_SITE_LIMITS = Object.freeze({
  files: 32,
  fileBytes: 256 * 1024,
  bytes: 1024 * 1024,
});

const TEXT_SITE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/svg+xml",
]);

const invalid = (code = "work_site_bundle_invalid") => {
  throw new Error(code);
};

function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > WORK_SITE_LIMITS.files)
    invalid("work_site_file_limit");
  const paths = new Set();
  let total = 0;
  const normalized = files.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !["path", "content"].includes(key)) ||
      typeof entry.content !== "string" ||
      entry.content.includes("\u0000")
    )
      invalid();
    const { path, type } = sitePath(entry.path);
    if (!TEXT_SITE_TYPES.has(type)) invalid("work_site_file_type_unsupported");
    const folded = path.toLowerCase();
    if (paths.has(folded)) invalid("work_site_duplicate_file");
    paths.add(folded);
    const bytes = new TextEncoder().encode(entry.content).byteLength;
    total += bytes;
    if (bytes > WORK_SITE_LIMITS.fileBytes || total > WORK_SITE_LIMITS.bytes)
      invalid("work_site_size_limit");
    return { path, content: entry.content };
  });
  if (!paths.has("index.html")) invalid("work_site_index_required");
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeTitle(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid("work_site_title_invalid");
  return value.trim();
}

/** Converts model output into one deterministic, immutable JSON artifact. */
export function compileWorkSiteBundle(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "site" ||
    Object.keys(value).some((key) => !["kind", "title", "files"].includes(key))
  )
    invalid();
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schema: WORK_SITE_BUNDLE_SCHEMA,
      title: normalizeTitle(value.title),
      files: normalizeFiles(value.files),
    }),
  );
  if (bytes.byteLength > WORK_SITE_LIMITS.bytes) invalid("work_site_size_limit");
  return bytes;
}

/** Parses only the exact artifact schema emitted by compileWorkSiteBundle. */
export function parseWorkSiteBundle(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > WORK_SITE_LIMITS.bytes
  )
    invalid("work_site_size_limit");
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== WORK_SITE_BUNDLE_SCHEMA ||
    Object.keys(value).some((key) => !["schema", "title", "files"].includes(key))
  )
    invalid();
  return { title: normalizeTitle(value.title), files: normalizeFiles(value.files) };
}

function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** Verifies owner, canonical Project storage, immutable digest and Sites payload before import. */
export async function loadVerifiedWorkSiteOutput(dependencies, ownerId, outputId) {
  siteUuid(ownerId);
  siteUuid(outputId);
  const output = await dependencies.readOutput(ownerId, outputId);
  if (
    !output ||
    output.id !== outputId ||
    output.owner_id !== ownerId ||
    output.mime_type !== "application/json" ||
    !/^[a-f0-9]{64}$/u.test(output.sha256 ?? "") ||
    !Number.isSafeInteger(output.size_bytes) ||
    output.size_bytes < 1 ||
    output.size_bytes > WORK_SITE_LIMITS.bytes
  )
    invalid("work_site_output_unavailable");
  const file = await dependencies.readProjectFile(ownerId, siteUuid(output.project_file_id));
  if (
    !file ||
    file.id !== output.project_file_id ||
    file.status !== "ready" ||
    file.mime_type !== output.mime_type ||
    file.content_sha256 !== output.sha256 ||
    file.size_bytes !== output.size_bytes ||
    typeof file.storage_path !== "string"
  )
    invalid("work_site_output_unverified");
  const content = await dependencies.download(file.storage_path);
  if (
    !(content instanceof Uint8Array) ||
    content.byteLength !== output.size_bytes ||
    (await sha256(content)) !== output.sha256
  )
    invalid("work_site_output_unverified");
  const bundle = parseWorkSiteBundle(content);
  const inspected = await inspectSiteFiles(
    bundle.files.map((entry) => ({
      path: entry.path,
      base64: base64(new TextEncoder().encode(entry.content)),
    })),
  );
  return { title: bundle.title, ...inspected };
}
