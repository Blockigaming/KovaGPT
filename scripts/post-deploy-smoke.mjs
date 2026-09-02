const base = new URL(process.env.KOVA_SMOKE_BASE_URL || "http://127.0.0.1:4173");
const expectedSha = process.env.KOVA_EXPECTED_SHA;
if (!expectedSha) throw new Error("KOVA_EXPECTED_SHA is required");

const timeoutValue = process.env.KOVA_SMOKE_REQUEST_TIMEOUT_MS || "10000";
const requestTimeoutMs = Number(timeoutValue);
if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 30000) {
  throw new Error("KOVA_SMOKE_REQUEST_TIMEOUT_MS must be an integer from 1000 through 30000");
}

const expectedSupabaseUrl = normalizeExpectedSupabaseUrl(process.env.KOVA_EXPECTED_SUPABASE_URL);
const MAX_JAVASCRIPT_ASSETS = 256;
const MAX_JAVASCRIPT_BYTES = 64 * 1024 * 1024;
const maximumBytesValue =
  process.env.KOVA_SMOKE_MAX_JAVASCRIPT_BYTES || String(MAX_JAVASCRIPT_BYTES);
const maxJavaScriptBytes = Number(maximumBytesValue);
if (
  !Number.isInteger(maxJavaScriptBytes) ||
  maxJavaScriptBytes < 1024 ||
  maxJavaScriptBytes > MAX_JAVASCRIPT_BYTES
) {
  throw new Error(
    "KOVA_SMOKE_MAX_JAVASCRIPT_BYTES must be an integer from 1024 through 67108864",
  );
}

const ABSOLUTE_HTTPS_URL_PATTERN = /https:\/\/[^\s"'`\\<>()\[\]{},;]+/giu;
const DYNAMIC_IMPORT_PATTERN =
  /\bimport\s*\(\s*["'`]([^"'`\s]+?\.m?js(?:\?[^"'`\s]*)?)["'`]\s*\)/giu;
const STATIC_IMPORT_PATTERN =
  /\bimport\s*(?:[^"'`]*?\bfrom\s*)?["'`]([^"'`\s]+?\.m?js(?:\?[^"'`\s]*)?)["'`]/giu;
const EXPORT_FROM_PATTERN =
  /\bexport\s+[^"'`]*?\bfrom\s*["'`]([^"'`\s]+?\.m?js(?:\?[^"'`\s]*)?)["'`]/giu;
const VITE_PRELOAD_ASSET_PATTERN =
  /["'`]((?:\/?assets\/)[^"'`\s]+?\.m?js(?:\?[^"'`\s]*)?)["'`]/giu;
const HTML_JAVASCRIPT_PATTERN =
  /<(?:script|link)\b[^>]*\b(?:src|href)=(?:"([^"]+\.m?js(?:\?[^"#]*)?)"|'([^']+\.m?js(?:\?[^'#]*)?)')[^>]*>/giu;
const JAVASCRIPT_DEPENDENCY_PATTERNS = [
  DYNAMIC_IMPORT_PATTERN,
  STATIC_IMPORT_PATTERN,
  EXPORT_FROM_PATTERN,
  VITE_PRELOAD_ASSET_PATTERN,
];
const JAVASCRIPT_CONTENT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "text/ecmascript",
  "text/javascript",
]);

function normalizeExpectedSupabaseUrl(raw) {
  if (!raw) return undefined;

  let value;
  try {
    value = new URL(raw);
  } catch {
    throw new Error("KOVA_EXPECTED_SUPABASE_URL must be an exact HTTPS Supabase project URL");
  }

  const hostname = /^([a-z0-9]{20})\.supabase\.co$/u.exec(value.hostname);
  if (
    value.protocol !== "https:" ||
    !hostname ||
    value.username ||
    value.password ||
    value.port ||
    (value.pathname !== "/" && value.pathname !== "") ||
    value.search ||
    value.hash
  ) {
    throw new Error("KOVA_EXPECTED_SUPABASE_URL must be an exact HTTPS Supabase project URL");
  }

  return {
    projectRef: hostname[1],
    url: `https://${hostname[1]}.supabase.co`,
  };
}

async function request(pathOrUrl, consume = (response) => response) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  timeout.unref?.();

  try {
    const response = await globalThis.fetch(url, {
      redirect: "manual",
      signal: controller.signal,
    });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${url.pathname} exceeded the ${requestTimeoutMs}ms request timeout`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function read(path, expectedType) {
  return request(path, async (response) => {
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes(expectedType))
      throw new Error(`${path} returned ${type || "no content type"}`);
    return { response, body: await response.text() };
  });
}

async function readBoundedJavaScript(response, url, maximumBytes) {
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!JAVASCRIPT_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      url.pathname +
        " returned non-JavaScript content type " +
        (contentType || "none"),
    );
  }

  const declaredValue = response.headers.get("content-length");
  const declaredBytes = declaredValue === null ? undefined : Number(declaredValue);
  if (
    Number.isFinite(declaredBytes) &&
    Number.isInteger(declaredBytes) &&
    declaredBytes > maximumBytes
  ) {
    throw new Error(
      "Deployed JavaScript scan exceeded " + maxJavaScriptBytes + " bytes",
    );
  }
  if (!response.body) {
    throw new Error(url.pathname + " returned no readable JavaScript body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decoded = [];
  let bytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(
          "Deployed JavaScript scan exceeded " + maxJavaScriptBytes + " bytes",
        );
      }
      decoded.push(decoder.decode(value, { stream: true }));
    }
    decoded.push(decoder.decode());
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(url.pathname + " is not valid UTF-8 JavaScript");
    }
    throw error;
  }

  return { source: decoded.join(""), bytes };
}

function discoverSupabaseProjectRefs(source, discoveredProjectRefs) {
  ABSOLUTE_HTTPS_URL_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(ABSOLUTE_HTTPS_URL_PATTERN)) {
    const rawUrl = match[0];
    if (!rawUrl.toLowerCase().includes(".supabase.co")) continue;

    let candidate;
    try {
      candidate = new URL(rawUrl);
    } catch {
      throw new Error("The deployed browser bundle contains a non-canonical Supabase URL");
    }

    const hostname = /^([a-z0-9]{20})\.supabase\.co$/u.exec(candidate.hostname);
    if (
      candidate.protocol !== "https:" ||
      !hostname ||
      candidate.username ||
      candidate.password ||
      candidate.port
    ) {
      throw new Error("The deployed browser bundle contains a non-canonical Supabase URL");
    }
    discoveredProjectRefs.add(hostname[1]);
  }
}

function addJavaScriptReference(candidate, parent, queue, seen) {
  let url;
  try {
    const resolutionBase = candidate.startsWith("assets/") ? new URL("/", base) : parent;
    url = new URL(candidate, resolutionBase);
  } catch {
    return;
  }

  url.hash = "";
  if (url.origin !== base.origin || !/\.m?js$/iu.test(url.pathname) || seen.has(url.href)) return;
  seen.add(url.href);
  queue.push(url);
}

function discoverJavaScript(source, parent, pattern, queue, seen) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    addJavaScriptReference(match[1] || match[2], parent, queue, seen);
  }
}

async function verifyDeployedBrowserTarget(rootHtml, expected) {
  const queue = [];
  const seen = new Set();
  discoverJavaScript(rootHtml, base, HTML_JAVASCRIPT_PATTERN, queue, seen);
  if (queue.length === 0) throw new Error("No deployed JavaScript assets were found");

  const discoveredProjectRefs = new Set();
  let scannedAssets = 0;
  let scannedBytes = 0;

  while (queue.length > 0) {
    if (scannedAssets >= MAX_JAVASCRIPT_ASSETS) {
      throw new Error(`Deployed JavaScript scan exceeded ${MAX_JAVASCRIPT_ASSETS} assets`);
    }

    const url = queue.shift();
    const result = await request(url, async (response) => {
      if (!response.ok) throw new Error(url.pathname + " returned " + response.status);
      return readBoundedJavaScript(response, url, maxJavaScriptBytes - scannedBytes);
    });
    scannedAssets += 1;
    scannedBytes += result.bytes;

    discoverSupabaseProjectRefs(result.source, discoveredProjectRefs);
    for (const pattern of JAVASCRIPT_DEPENDENCY_PATTERNS) {
      discoverJavaScript(result.source, url, pattern, queue, seen);
    }
  }

  if (!discoveredProjectRefs.has(expected.projectRef)) {
    throw new Error(
      "The deployed browser bundle does not contain the expected Supabase project URL",
    );
  }
  if ([...discoveredProjectRefs].some((projectRef) => projectRef !== expected.projectRef)) {
    throw new Error("The deployed browser bundle contains an unexpected Supabase project URL");
  }
}

const version = await read("/api/version", "application/json");
const identity = JSON.parse(version.body);
if (identity.sha !== expectedSha || version.response.headers.get("x-kova-build") !== expectedSha) {
  throw new Error(`deployed build ${identity.sha || "unknown"} does not match ${expectedSha}`);
}

let rootBody = "";
for (const path of ["/", "/pricing", "/modes", "/~oauth/callback", "/robots.txt", "/sitemap.xml"]) {
  const { body } = await read(
    path,
    path.endsWith(".xml") ? "xml" : path.endsWith(".txt") ? "text" : "text/html",
  );
  if (path === "/") rootBody = body;
  if (/voice synthesis|voice mode|Basic Mode|Creative Mode|Precise Mode/i.test(body)) {
    throw new Error(`${path} contains retired product claims`);
  }
}

if (expectedSupabaseUrl) {
  await verifyDeployedBrowserTarget(rootBody, expectedSupabaseUrl);
}

const missing = await request(`/release-smoke-missing-${Date.now()}`);
if (missing.status !== 404)
  throw new Error(`unknown route returned ${missing.status}, expected 404`);
console.log(`KovaGPT deployment ${expectedSha} passed smoke checks at ${base.origin}`);
