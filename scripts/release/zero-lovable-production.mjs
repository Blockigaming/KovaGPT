import { writeFileSync } from "node:fs";

const SHA = /^[a-f0-9]{40}$/u;
const HTML_TAG =
  /<(base|script|link|img|source|video|audio|track|iframe|embed|object|input)\b([^>]*)>/giu;
const HTML_ATTRIBUTE =
  /\b([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
const JS_DYNAMIC_IMPORT = /\bimport\s*\(\s*["'`]([^"'`\r\n]+)["'`]\s*\)/gu;
const JS_STATIC_IMPORT =
  /\b(?:import|export)\s+(?:[^"'`\r\n;]*?\sfrom\s*)?["'`]([^"'`\r\n]+)["'`]/gu;
const JS_REQUIRE = /\brequire\s*\(\s*["'`]([^"'`\r\n]+)["'`]\s*\)/gu;
const JS_WORKER_NEW_URL =
  /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*new\s+URL\s*\(\s*["'`]([^"'`\r\n]+)["'`]\s*,\s*import\.meta\.url\s*\)/gu;
const JS_WORKER_DIRECT = /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*["'`]([^"'`\r\n]+)["'`]/gu;
const SERVICE_WORKER_REGISTER =
  /\b(?:navigator\.)?serviceWorker\.register\s*\(\s*["'`]([^"'`\r\n]+)["'`]/gu;
const WORKER_IMPORT_SCRIPTS = /\bimportScripts\s*\(([^)]*)\)/gu;
const CACHE_ADD = /\b(?:cache|caches(?:\.open\([^)]*\))?)\.add\s*\(\s*["'`]([^"'`\r\n]+)["'`]/gu;
const CACHE_ADD_ALL = /\b(?:cache|caches(?:\.open\([^)]*\))?)\.addAll\s*\(\s*\[([^\]]*)\]/gu;
const STRING_REFERENCE = /["'`]([^"'`\r\n]+)["'`]/gu;
const VITE_PRELOAD_REFERENCE =
  /["'`](assets\/[^"'`\r\n]+\.(?:mjs|cjs|js|css)(?:\?[^"'`\r\n]*)?)["'`]/gu;
const BUILD_META =
  /<meta\b(?=[^>]*\bname=["']kova-build["'])(?=[^>]*\bcontent=["']([a-f0-9]{40})["'])[^>]*>/giu;
const RETIRED_ROUTES = [
  "/.lovable/oauth/consent",
  "/lovable/email/suppression",
  "/lovable/email/auth/preview",
  "/lovable/email/auth/webhook",
  "/lovable/email/queue/process",
  "/lovable/email/transactional/preview",
  "/lovable/email/transactional/send",
];
const SAFE_ROUTE_PROBES = ["GET", "HEAD", "OPTIONS"];
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 120_000;
const JAVASCRIPT_CONTENT_TYPE = /(?:javascript|ecmascript)/iu;
const CSS_CONTENT_TYPE = /^text\/css\b/iu;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')][^)]*?))\s*\)/giu;
const HTML_CONTENT_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/iu;
const LOVABLE_HOST = /(?:^|\.)lovable\.(?:app|dev)$/iu;

function normalizeBase(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("production_base_must_use_https");
  const hostname = url.hostname.replace(/\.+$/u, "");
  if (LOVABLE_HOST.test(hostname)) throw new Error("production_base_must_not_use_lovable");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function addAssetReference(
  assets,
  reference,
  parent,
  origin,
  { allowAny = false, resolveFromOriginRoot = false, rejectedDataUrls } = {},
) {
  const value = reference?.trim();
  if (!value || /^(?:javascript:|#)/iu.test(value)) return;
  if (/^data:/iu.test(value)) {
    const comma = value.indexOf(",");
    rejectedDataUrls?.add(comma === -1 ? "data:" : value.slice(0, comma + 1));
    return;
  }
  let url;
  try {
    url = new URL(value, resolveFromOriginRoot ? new URL("/", origin) : parent);
  } catch {
    return;
  }
  url.hash = "";
  if (url.origin !== origin) return;
  const pathname = url.pathname.toLowerCase();
  if (allowAny || pathname.includes("/assets/") || /\.(?:mjs|cjs|js|css)$/u.test(pathname)) {
    assets.add(url.href);
  }
}

function discoverAssets(source, parent, origin, rejectedDataUrls = new Set()) {
  const assets = new Set();
  let documentBase = parent;

  for (const match of source.matchAll(HTML_TAG)) {
    if (match[1].toLowerCase() !== "base") continue;
    const href = [...match[2].matchAll(HTML_ATTRIBUTE)].find(
      (attribute) => attribute[1].toLowerCase() === "href",
    );
    if (!href) continue;
    try {
      documentBase = new URL(href[2] ?? href[3] ?? href[4] ?? "", parent);
      break;
    } catch {
      // Browsers ignore invalid base URLs and continue looking for a usable base.
    }
  }

  for (const match of source.matchAll(HTML_TAG)) {
    const tag = match[1].toLowerCase();
    if (tag === "base") continue;
    const attributes = new Map();
    for (const attribute of match[2].matchAll(HTML_ATTRIBUTE)) {
      attributes.set(
        attribute[1].toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
      );
    }
    if (!["script", "link"].includes(tag)) {
      const references = [];
      for (const name of tag === "object" ? ["data"] : ["src"]) {
        if (attributes.get(name)) references.push(attributes.get(name));
      }
      for (const candidate of (attributes.get("srcset") ?? "").split(",")) {
        const reference = candidate.trim().split(/\s+/u)[0];
        if (reference) references.push(reference);
      }
      for (const reference of references)
        addAssetReference(assets, reference, documentBase, origin, {
          allowAny: true,
          rejectedDataUrls,
        });
      continue;
    }
    const reference = tag === "script" ? attributes.get("src") : attributes.get("href");
    if (!reference) continue;
    if (tag === "script") {
      addAssetReference(assets, reference, documentBase, origin, {
        allowAny: true,
        rejectedDataUrls,
      });
      continue;
    }
    const rel = new Set((attributes.get("rel") ?? "").toLowerCase().split(/\s+/u).filter(Boolean));
    const as = (attributes.get("as") ?? "").toLowerCase();
    const browserConsumedLink =
      rel.has("stylesheet") ||
      rel.has("modulepreload") ||
      rel.has("manifest") ||
      [...rel].some((value) => value === "icon" || value.endsWith("icon")) ||
      (rel.has("preload") && ["script", "style", "fetch"].includes(as));
    addAssetReference(assets, reference, documentBase, origin, {
      allowAny: browserConsumedLink,
      rejectedDataUrls,
    });
  }

  for (const pattern of [
    JS_DYNAMIC_IMPORT,
    JS_STATIC_IMPORT,
    JS_REQUIRE,
    JS_WORKER_NEW_URL,
    JS_WORKER_DIRECT,
    SERVICE_WORKER_REGISTER,
  ]) {
    for (const match of source.matchAll(pattern)) {
      addAssetReference(assets, match[1], parent, origin, { allowAny: true, rejectedDataUrls });
    }
  }

  for (const match of source.matchAll(VITE_PRELOAD_REFERENCE)) {
    addAssetReference(assets, match[1], parent, origin, {
      allowAny: true,
      resolveFromOriginRoot: true,
    });
  }

  for (const match of source.matchAll(WORKER_IMPORT_SCRIPTS)) {
    for (const reference of match[1].matchAll(STRING_REFERENCE)) {
      addAssetReference(assets, reference[1], parent, origin, { allowAny: true, rejectedDataUrls });
    }
  }
  for (const match of source.matchAll(CACHE_ADD)) {
    addAssetReference(assets, match[1], parent, origin, { allowAny: true, rejectedDataUrls });
  }
  for (const match of source.matchAll(CACHE_ADD_ALL)) {
    for (const reference of match[1].matchAll(STRING_REFERENCE)) {
      addAssetReference(assets, reference[1], parent, origin, { allowAny: true, rejectedDataUrls });
    }
  }

  return [...assets].sort();
}

function discoverCssAssets(source, parent, origin) {
  const assets = new Set();
  for (const match of source.matchAll(CSS_URL)) {
    addAssetReference(assets, match[1] ?? match[2] ?? match[3], parent, origin, { allowAny: true });
  }
  return [...assets].sort();
}

function withoutHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/gu, "");
}

function discoverLinkHeaderAssets(value, parent, origin) {
  const assets = new Set();
  for (const match of (value ?? "").matchAll(/<([^>]+)>\s*((?:;[^,]*)?)(?:,|$)/gu)) {
    const parameters = match[2];
    const rel = parameters.match(/;\s*rel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;,\s]+))/iu);
    const relations = new Set((rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase().split(/\s+/u));
    if (!relations.has("preload") && !relations.has("modulepreload")) continue;
    addAssetReference(assets, match[1], parent, origin, { allowAny: true });
  }
  return [...assets].sort();
}

function discoverJsonAssets(source, parent, origin) {
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    return [];
  }
  const assets = new Set();
  const visit = (value, key = "") => {
    if (typeof value === "string" && key === "src") {
      addAssetReference(assets, value, parent, origin, { allowAny: true });
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey.toLowerCase()));
    }
  };
  visit(document);
  return [...assets].sort();
}

function decodedPathname(value) {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }
}

// Fetch URLs stay intact; persisted evidence must never retain signed-query credentials.
function redactUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?redacted";
    url.hash = "";
    return url.href;
  } catch {
    return String(value).replace(/\?.*$/u, "");
  }
}

function redactLocation(value, base) {
  if (!value) return null;
  try {
    return redactUrl(new URL(value, base));
  } catch {
    return "<invalid-location>";
  }
}

function assetKind(value) {
  const pathname = new URL(value).pathname.toLowerCase();
  if (/\.(?:mjs|cjs|js)$/u.test(pathname)) return "javascript";
  if (/\.css$/u.test(pathname)) return "css";
  return "other";
}

function isTextAsset(kind, contentType = "") {
  return (
    kind !== "other" ||
    /^text\//iu.test(contentType) ||
    JAVASCRIPT_CONTENT_TYPE.test(contentType) ||
    CSS_CONTENT_TYPE.test(contentType) ||
    /(?:json|xml|svg)/iu.test(contentType)
  );
}

function createCookieJar(origin) {
  const cookies = new Map();
  let sequence = 0;
  const matchesPath = (requestPath, cookiePath) =>
    requestPath === cookiePath ||
    (requestPath.startsWith(cookiePath) &&
      (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"));
  return {
    update(response, requestUrl) {
      const url = new URL(response.url || requestUrl);
      if (url.origin !== origin) return;
      const values = response.headers.getSetCookie?.() ?? [];
      if (!values.length && response.headers.has("set-cookie"))
        values.push(response.headers.get("set-cookie"));
      for (const value of values) {
        const [pair, ...parts] = value.split(";");
        const separator = pair.indexOf("=");
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const content = pair.slice(separator + 1).trim();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) continue;
        const attributes = new Map(
          parts.map((part) => {
            const position = part.indexOf("=");
            return position === -1
              ? [part.trim().toLowerCase(), ""]
              : [part.slice(0, position).trim().toLowerCase(), part.slice(position + 1).trim()];
          }),
        );
        const domain = (attributes.get("domain") ?? url.hostname).toLowerCase().replace(/^\./u, "");
        if (domain !== url.hostname && !url.hostname.endsWith(`.${domain}`)) continue;
        const slash = url.pathname.lastIndexOf("/");
        const defaultPath = slash <= 0 ? "/" : url.pathname.slice(0, slash);
        const requestedPath = attributes.get("path") ?? "";
        const path = requestedPath.startsWith("/") ? requestedPath : defaultPath;
        if (name.startsWith("__Secure-") && !attributes.has("secure")) continue;
        if (
          name.startsWith("__Host-") &&
          (!attributes.has("secure") || attributes.has("domain") || path !== "/")
        )
          continue;
        const key = JSON.stringify([name, domain, path]);
        let expires = Date.parse(attributes.get("expires") ?? "");
        const maxAge = attributes.get("max-age");
        if (/^-?\d+$/u.test(maxAge ?? "")) expires = Date.now() + Number(maxAge) * 1000;
        if (Number.isFinite(expires) && expires <= Date.now()) {
          cookies.delete(key);
          continue;
        }
        cookies.set(key, {
          name,
          content,
          path,
          expires,
          sequence: cookies.get(key)?.sequence ?? sequence++,
        });
      }
    },
    header(requestUrl) {
      const url = new URL(requestUrl);
      if (url.origin !== origin) return "";
      return [...cookies.values()]
        .filter(
          (cookie) =>
            (!Number.isFinite(cookie.expires) || cookie.expires > Date.now()) &&
            matchesPath(url.pathname, cookie.path),
        )
        .sort((a, b) => b.path.length - a.path.length || a.sequence - b.sequence)
        .map((cookie) => `${cookie.name}=${cookie.content}`)
        .join("; ");
    },
  };
}

async function readBoundedText(response, limits) {
  if (!response.body) return { body: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const strictDecoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let body = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    limits.budget.bytes += value.byteLength;
    if (bytes > limits.maxResponseBytes) {
      await reader.cancel().catch(() => {});
      const error = new Error("response_body_limit_exceeded");
      error.code = "response_body_limit_exceeded";
      error.bytes = bytes;
      throw error;
    }
    if (limits.budget.bytes > limits.maxTotalBytes) {
      await reader.cancel().catch(() => {});
      const error = new Error("aggregate_body_limit_exceeded");
      error.code = "aggregate_body_limit_exceeded";
      error.bytes = bytes;
      throw error;
    }
    chunks.push(value);
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  let invalidUtf8 = false;
  try {
    for (const chunk of chunks) strictDecoder.decode(chunk, { stream: true });
    strictDecoder.decode();
  } catch {
    invalidUtf8 = true;
  }
  return { body, bytes, invalidUtf8 };
}

async function request(url, { redirect = "follow", method = "GET", cookie } = {}, limits) {
  const remainingMs = limits.deadline - Date.now();
  if (remainingMs <= 0) return deadlineResult(url, method);
  let response;
  const signal = AbortSignal.timeout(Math.min(15_000, remainingMs));
  try {
    response = await fetch(url, {
      method,
      redirect,
      signal,
      headers: {
        "user-agent": "KovaGPT-read-only-zero-lovable-evidence/1",
        ...(cookie ? { cookie } : {}),
      },
    });
  } catch (error) {
    if (
      signal.aborted ||
      Date.now() >= limits.deadline ||
      ["AbortError", "TimeoutError"].includes(error?.name)
    )
      return deadlineResult(url, method);
    throw error;
  }
  let body = "";
  let bytes = 0;
  let readFailure = null;
  let invalidUtf8 = false;
  try {
    ({ body, bytes, invalidUtf8 } = await readBoundedText(response, limits));
  } catch (error) {
    if (
      signal.aborted ||
      Date.now() >= limits.deadline ||
      ["AbortError", "TimeoutError"].includes(error?.name)
    )
      return deadlineResult(url, method);
    if (!["response_body_limit_exceeded", "aggregate_body_limit_exceeded"].includes(error?.code))
      throw error;
    readFailure = error.code;
    bytes = error.bytes ?? bytes;
  }
  const finalUrl = response.url || String(url);
  return {
    response,
    body,
    readFailure,
    invalidUtf8,
    record: {
      method,
      url: redactUrl(finalUrl),
      status: response.status,
      location: redactLocation(response.headers.get("location"), finalUrl),
      contentType: response.headers.get("content-type"),
      bytes,
    },
  };
}

function deadlineResult(url, method) {
  const response = new Response("", { status: 408 });
  Object.defineProperty(response, "url", { value: String(url) });
  return {
    response,
    body: "",
    readFailure: "collection_deadline_exceeded",
    invalidUtf8: false,
    record: {
      method,
      url: redactUrl(url),
      status: 408,
      location: null,
      contentType: null,
      bytes: 0,
    },
  };
}

export async function collectZeroLovableProductionEvidence({
  baseUrl,
  expectedSha,
  maxAssets = 500,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  now = () => new Date(),
}) {
  if (!SHA.test(expectedSha ?? "")) throw new Error("expected_sha_required");
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
    throw new Error("max_response_bytes_invalid");
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxResponseBytes)
    throw new Error("max_total_bytes_invalid");
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1)
    throw new Error("max_duration_ms_invalid");
  const base = normalizeBase(baseUrl);
  const failures = [];
  const limits = {
    budget: { bytes: 0 },
    maxResponseBytes,
    maxTotalBytes,
    deadline: Date.now() + maxDurationMs,
  };
  const hintedAssets = [];
  const versionUrl = new URL("/api/version", base);
  const versionResult = await request(versionUrl, { redirect: "manual" }, limits);
  if (versionResult.readFailure) failures.push(`${versionResult.readFailure}:/api/version`);
  const versionFinalUrl = new URL(versionResult.response.url || versionUrl.href);
  if (
    versionResult.response.redirected ||
    (versionResult.response.status >= 300 && versionResult.response.status < 400) ||
    versionResult.response.headers.get("location") ||
    versionFinalUrl.href !== versionUrl.href
  )
    failures.push("version_redirected");
  let version = null;
  try {
    version = JSON.parse(versionResult.body);
  } catch {
    failures.push("version_response_not_json");
  }
  const headerSha = versionResult.response.headers.get("x-kova-build");
  if (/lovable/iu.test(versionResult.body)) failures.push("lovable_version_content");
  if (versionResult.response.status !== 200) failures.push("version_status_not_200");
  if (version?.sha !== expectedSha) failures.push("version_sha_mismatch");
  if (headerSha !== expectedSha) failures.push("version_header_sha_mismatch");
  hintedAssets.push(
    ...discoverLinkHeaderAssets(
      versionResult.response.headers.get("link"),
      versionFinalUrl,
      base.origin,
    ),
  );

  const routeRecords = [];
  for (const path of RETIRED_ROUTES) {
    for (const method of SAFE_ROUTE_PROBES) {
      const result = await request(new URL(path, base), { redirect: "manual", method }, limits);
      routeRecords.push({ path, ...result.record });
      hintedAssets.push(
        ...discoverLinkHeaderAssets(
          result.response.headers.get("link"),
          new URL(result.response.url || new URL(path, base).href),
          base.origin,
        ),
      );
      if (result.readFailure) failures.push(`${result.readFailure}:${method}:${path}`);
      if (/lovable/iu.test(result.body))
        failures.push(`lovable_retired_route_content:${method}:${path}`);
      if (result.response.status !== 404) failures.push(`retired_route_not_404:${method}:${path}`);
      if (result.response.headers.get("location"))
        failures.push(`retired_route_redirects:${method}:${path}`);
      const allowed = [
        result.response.headers.get("allow"),
        result.response.headers.get("access-control-allow-methods"),
      ]
        .filter(Boolean)
        .join(",");
      if (/\b(?:POST|PUT|PATCH|DELETE)\b/iu.test(allowed))
        failures.push(`retired_route_unsafe_method_advertised:${path}`);
    }
  }

  const rootResult = await request(base, { redirect: "manual" }, limits);
  if (rootResult.readFailure) failures.push(`${rootResult.readFailure}:root`);
  if (rootResult.response.status !== 200) failures.push("root_status_not_200");
  const rootContentType = rootResult.response.headers.get("content-type") ?? "";
  if (!HTML_CONTENT_TYPE.test(rootContentType)) failures.push("root_content_type_not_html");
  const rootFinalUrl = new URL(rootResult.response.url || base.href);
  // A redirect changes the production surface being certified, so it is never an alternate base.
  if (
    rootResult.response.redirected ||
    (rootResult.response.status >= 300 && rootResult.response.status < 400) ||
    rootResult.response.headers.get("location") ||
    rootFinalUrl.href !== base.href
  )
    failures.push("root_redirected");
  if (/lovable/iu.test(rootResult.body)) failures.push("lovable_root_content");
  const liveRootBody = withoutHtmlComments(rootResult.body);
  const rootBuildShas = [...liveRootBody.matchAll(BUILD_META)].map((match) => match[1]);
  const rootBuildSha = rootBuildShas.length === 1 ? rootBuildShas[0] : null;
  if (rootBuildSha !== expectedSha) failures.push("root_build_sha_mismatch");
  const cookieJar = createCookieJar(base.origin);
  cookieJar.update(rootResult.response, rootFinalUrl);
  const rejectedDataUrls = new Set();

  const pending = [
    ...hintedAssets,
    ...discoverAssets(liveRootBody, rootFinalUrl, base.origin, rejectedDataUrls),
    ...discoverLinkHeaderAssets(rootResult.response.headers.get("link"), rootFinalUrl, base.origin),
  ];
  for (const value of rejectedDataUrls) failures.push(`data_url_asset_rejected:${value}`);
  const seen = new Set();
  const assets = [];
  const contentHits = [];
  let browserBuildShaFound = false;
  while (pending.length && seen.size < maxAssets) {
    const url = pending.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const requestedUrl = new URL(url);
    const requestedDisplayUrl = redactUrl(requestedUrl);
    const requestedPathname = decodedPathname(requestedUrl);
    if (requestedPathname === null)
      failures.push(`asset_path_decode_failed:${requestedDisplayUrl}`);
    else if (/lovable/iu.test(requestedPathname))
      failures.push(`lovable_asset_name:${requestedDisplayUrl}`);
    const result = await request(
      url,
      { redirect: "manual", cookie: cookieJar.header(requestedUrl) },
      limits,
    );
    assets.push(result.record);
    const finalUrl = new URL(result.response.url || url);
    cookieJar.update(result.response, requestedUrl);
    const displayUrl = result.record.url;
    const redirected =
      result.response.redirected ||
      (result.response.status >= 300 && result.response.status < 400) ||
      Boolean(result.response.headers.get("location")) ||
      finalUrl.href !== requestedUrl.href;
    if (redirected) failures.push(`asset_redirected:${displayUrl}`);
    if (finalUrl.origin !== base.origin) failures.push(`asset_redirect_cross_origin:${displayUrl}`);
    const finalPathname = decodedPathname(finalUrl);
    if (finalPathname === null) failures.push(`asset_path_decode_failed:${displayUrl}`);
    else if (/lovable/iu.test(finalPathname)) failures.push(`lovable_asset_name:${displayUrl}`);
    if (result.readFailure) failures.push(`${result.readFailure}:${displayUrl}`);
    if (result.response.status !== 200) failures.push(`asset_status_not_200:${displayUrl}`);

    const requestedKind = assetKind(requestedUrl);
    const finalKind = assetKind(finalUrl);
    const pathKind =
      requestedKind === "javascript" || finalKind === "javascript"
        ? "javascript"
        : requestedKind === "css" || finalKind === "css"
          ? "css"
          : "other";
    const contentType = result.response.headers.get("content-type") ?? "";
    const kind = JAVASCRIPT_CONTENT_TYPE.test(contentType)
      ? "javascript"
      : CSS_CONTENT_TYPE.test(contentType)
        ? "css"
        : pathKind;
    const contentTypeValid =
      kind === "javascript"
        ? JAVASCRIPT_CONTENT_TYPE.test(contentType)
        : kind === "css"
          ? CSS_CONTENT_TYPE.test(contentType)
          : true;
    if (!contentTypeValid) failures.push(`asset_content_type_mismatch:${displayUrl}`);

    if (!result.readFailure && isTextAsset(kind, contentType)) {
      if (result.invalidUtf8) failures.push(`asset_invalid_utf8:${displayUrl}`);
      if (/lovable/iu.test(result.body)) {
        contentHits.push(displayUrl);
        failures.push(`lovable_asset_content:${displayUrl}`);
      }
      if (kind === "javascript" && contentTypeValid && result.body.includes(expectedSha))
        browserBuildShaFound = true;
      if (kind === "css") {
        for (const nested of discoverCssAssets(result.body, finalUrl, base.origin)) {
          if (!seen.has(nested) && !pending.includes(nested)) pending.push(nested);
        }
      }
      const nestedDataUrls = new Set();
      for (const nested of discoverAssets(result.body, finalUrl, base.origin, nestedDataUrls)) {
        if (!seen.has(nested) && !pending.includes(nested)) pending.push(nested);
      }
      for (const value of nestedDataUrls) failures.push(`data_url_asset_rejected:${value}`);
      if (/(?:application\/manifest\+json|application\/json)/iu.test(contentType)) {
        for (const nested of discoverJsonAssets(result.body, finalUrl, base.origin)) {
          if (!seen.has(nested) && !pending.includes(nested)) pending.push(nested);
        }
      }
      for (const nested of discoverLinkHeaderAssets(
        result.response.headers.get("link"),
        finalUrl,
        base.origin,
      )) {
        if (!seen.has(nested) && !pending.includes(nested)) pending.push(nested);
      }
    }
    if (result.readFailure === "collection_deadline_exceeded") break;
    if (result.readFailure === "aggregate_body_limit_exceeded") break;
  }
  if (pending.length) failures.push(`asset_limit_exceeded:${maxAssets}`);
  if (!browserBuildShaFound) failures.push("browser_build_sha_not_found");

  const exactSha =
    version?.sha === expectedSha &&
    headerSha === expectedSha &&
    rootBuildSha === expectedSha &&
    browserBuildShaFound;

  return {
    schemaVersion: 1,
    capturedAt: now().toISOString(),
    readOnly: true,
    baseUrl: base.href,
    expectedSha,
    observedSha: version?.sha ?? null,
    observedHeaderSha: headerSha,
    observedRootSha: rootBuildSha,
    browserBuildShaFound,
    exactSha,
    routes: routeRecords,
    assetScan: {
      count: assets.length,
      assets,
      lovableContentHits: contentHits,
      totalBytesRead: limits.budget.bytes,
      maxResponseBytes,
      maxTotalBytes,
    },
    limitations: [
      "Public HTTP evidence only; this does not inspect authenticated browser traffic.",
      "Retired API methods are checked only with safe GET/HEAD/OPTIONS capability probes; control-plane route inventories remain required for definitive unsafe-method absence.",
      "Azure, Cloudflare, Supabase, OAuth-provider, email-provider, and log inventories require separate read-only exports.",
    ],
    failures: [...new Set(failures)].sort(),
    pass: failures.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.env.KOVA_PRODUCTION_BASE_URL ?? process.argv[2];
  const expectedSha = process.env.KOVA_EXPECTED_RELEASE_SHA ?? process.argv[3];
  const output = process.env.KOVA_ZERO_LOVABLE_EVIDENCE_FILE;
  if (!baseUrl) throw new Error("production_base_url_required");
  const evidence = await collectZeroLovableProductionEvidence({ baseUrl, expectedSha });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) writeFileSync(output, serialized, { flag: "wx" });
  process.stdout.write(serialized);
  if (!evidence.pass) process.exitCode = 1;
}
