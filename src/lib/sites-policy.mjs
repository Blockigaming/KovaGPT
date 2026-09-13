export const SITE_LIMITS = Object.freeze({
  files: 64,
  fileBytes: 2 * 1024 * 1024,
  versionBytes: 8 * 1024 * 1024,
  bodyBytes: 12 * 1024 * 1024,
  sites: 20,
  versions: 20,
  viewers: 50,
});
export const SITE_TYPES = Object.freeze({
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
});
export class SiteInputError extends Error {
  constructor(code = "site_request_invalid") {
    super(code);
    this.code = code;
  }
}
export function siteUuid(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
    throw new SiteInputError();
  return value.toLowerCase();
}
export function siteSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/u.test(value))
    throw new SiteInputError("site_name_invalid");
  return value;
}
export function sitePath(value) {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/u.test(value) ||
    value.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith("__kova"))
  )
    throw new SiteInputError("site_file_path_invalid");
  const type = SITE_TYPES[value.split(".").pop()?.toLowerCase()];
  if (!type) throw new SiteInputError("site_file_type_unsupported");
  return { path: value, type };
}
export async function sha256(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function inspectSiteFiles(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > SITE_LIMITS.files)
    throw new SiteInputError("site_file_limit");
  const files = [];
  const paths = new Set();
  let total = 0;
  for (const entry of input) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).some((k) => !["path", "base64"].includes(k)) ||
      typeof entry.base64 !== "string" ||
      entry.base64.length > Math.ceil(SITE_LIMITS.fileBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(entry.base64)
    )
      throw new SiteInputError("site_file_invalid");
    const { path, type } = sitePath(entry.path);
    if (paths.has(path.toLowerCase())) throw new SiteInputError("site_duplicate_file");
    paths.add(path.toLowerCase());
    const decoded = Uint8Array.from(atob(entry.base64), (c) => c.charCodeAt(0));
    total += decoded.byteLength;
    if (decoded.byteLength > SITE_LIMITS.fileBytes || total > SITE_LIMITS.versionBytes)
      throw new SiteInputError("site_size_limit");
    files.push({
      path,
      type,
      base64: entry.base64,
      size: decoded.byteLength,
      sha256: await sha256(decoded),
    });
  }
  if (!files.some((file) => file.path === "index.html"))
    throw new SiteInputError("site_index_required");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = files.map(({ path, type, size, sha256 }) => ({ path, type, size, sha256 }));
  return { files, bytes: total, manifestSha256: await sha256(JSON.stringify(manifest)) };
}
// Require an explicit deployment-approved asset root on a different registrable
// domain. The dedicated server additionally accepts only an exact UUID host.
export function siteHostingConfig(env = {}) {
  try {
    if (env.KOVA_SITES_HOSTING_ENABLED !== "true" || env.KOVA_SITES_ISOLATION_APPROVED !== "true")
      return null;
    const app = new URL(env.KOVA_SITES_APP_ORIGIN),
      asset = new URL(env.KOVA_SITES_ASSET_ORIGIN);
    if (
      app.protocol !== "https:" ||
      asset.protocol !== "https:" ||
      app.username ||
      asset.username ||
      app.password ||
      asset.password ||
      app.port ||
      asset.port ||
      app.pathname !== "/" ||
      asset.pathname !== "/" ||
      app.search ||
      asset.search ||
      app.hash ||
      asset.hash
    )
      return null;
    const root = asset.hostname.toLowerCase();
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(root) ||
      app.hostname === root ||
      app.hostname.endsWith("." + root) ||
      root.endsWith("." + app.hostname)
    )
      return null;
    // Reject shared DNS suffixes conservatively, including registrable roots.
    // Deployment approval must also verify the application cookie boundary.
    if (app.hostname.split(".").slice(-2).join(".") === root.split(".").slice(-2).join("."))
      return null;
    return { appOrigin: app.origin, assetOrigin: asset.origin, assetHost: root };
  } catch {
    return null;
  }
}
export function siteOrigin(config, siteId) {
  return `https://${siteUuid(siteId)}.${config.assetHost}`;
}
export function siteAssetRequest(request, config) {
  if (!config) return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  const suffix = "." + config.assetHost;
  if (!url.hostname.endsWith(suffix)) return null;
  let id;
  try {
    id = siteUuid(url.hostname.slice(0, -suffix.length));
  } catch {
    return null;
  }
  return { siteId: id, url };
}
