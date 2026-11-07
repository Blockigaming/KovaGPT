// Compatibility policy for the retained KovaGPT app and account/legal pages.
// Removed public/marketing catalogs do not contribute routes or indexable URLs.
export const PUBLIC_BUSINESS_PATHS = Object.freeze([]);
export const PUBLIC_ECOSYSTEM_PATHS = Object.freeze([]);
export const PUBLIC_FORM_PATHS = Object.freeze([]);
export const PUBLIC_GLOBAL_AFFAIRS_PATHS = Object.freeze([]);
export const PUBLIC_POLICY_PATHS = Object.freeze([]);
export const PUBLIC_SITEMAP_ENTRIES = Object.freeze([
  Object.freeze({ path: "/", changefreq: "monthly", priority: "1.0" }),
]);
export const PUBLIC_REVIEW_PATHS = Object.freeze([
  "/",
  "/pricing",
  "/terms",
  "/privacy",
  "/refund",
  "/help",
  "/contact-support",
]);
const PUBLIC_INDEXABLE_PATHS = new Set(["/"]);
const PUBLIC_FOLLOWABLE_NOINDEX_PATHS = new Set([
  "/login",
  "/signup",
  "/pricing",
  "/terms",
  "/privacy",
  "/refund",
  "/help",
  "/contact-support",
]);
const NON_INDEXABLE_STATUSES = new Set(["error", "notFound", "redirected"]);

export function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return "";
  }
  const [path = ""] = pathname.split(/[?#]/u, 1);
  return path === "/" ? "/" : path.replace(/\/+$/u, "");
}
export function isPublicIndexableRoute(pathname, statuses = []) {
  if (statuses.some((status) => NON_INDEXABLE_STATUSES.has(status))) return false;
  return PUBLIC_INDEXABLE_PATHS.has(normalizePathname(pathname));
}
export function robotsDirectiveForRoute(pathname, statuses = []) {
  if (statuses.some((status) => NON_INDEXABLE_STATUSES.has(status))) return "noindex, nofollow";
  const normalized = normalizePathname(pathname);
  if (PUBLIC_INDEXABLE_PATHS.has(normalized)) return "index, follow";
  if (PUBLIC_FOLLOWABLE_NOINDEX_PATHS.has(normalized)) return "noindex, follow";
  return "noindex, nofollow";
}
