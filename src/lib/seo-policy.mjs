// KovaGPT is an application, not a marketing site. All routes fail closed to noindex.
export const PUBLIC_BUSINESS_PATHS = Object.freeze([]);
export const PUBLIC_ECOSYSTEM_PATHS = Object.freeze([]);
export const PUBLIC_FORM_PATHS = Object.freeze([]);
export const PUBLIC_GLOBAL_AFFAIRS_PATHS = Object.freeze([]);
export const PUBLIC_POLICY_PATHS = Object.freeze([]);
export const PUBLIC_SITEMAP_ENTRIES = Object.freeze([]);
export const PUBLIC_REVIEW_PATHS = Object.freeze([]);
const NOINDEX_FOLLOW = new Set(["/login", "/signup", "/pricing", "/help", "/privacy", "/terms", "/refund", "/contact-support"]);
export function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) return "";
  const [part = ""] = pathname.split(/[?#]/u, 1);
  return part === "/" ? part : part.replace(/\/+$/u, "");
}
export function isPublicIndexableRoute() { return false; }
export function robotsDirectiveForRoute(pathname, statuses = []) {
  if (statuses.some((status) => ["error", "notFound", "redirected"].includes(status))) return "noindex, nofollow";
  return NOINDEX_FOLLOW.has(normalizePathname(pathname)) ? "noindex, follow" : "noindex, nofollow";
}
