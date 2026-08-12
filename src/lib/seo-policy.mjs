const PUBLIC_SITEMAP_ENTRIES = Object.freeze(
  [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/images", changefreq: "weekly", priority: "0.8" },
    { path: "/pricing", changefreq: "monthly", priority: "0.8" },
    { path: "/modes", changefreq: "monthly", priority: "0.6" },
    { path: "/status", changefreq: "weekly", priority: "0.3" },
    { path: "/blog/best-ai-assistants", changefreq: "monthly", priority: "0.7" },
    { path: "/blog/ai-market-research-guide", changefreq: "monthly", priority: "0.7" },
    { path: "/blog/best-ai-market-research-tools", changefreq: "monthly", priority: "0.7" },
    { path: "/privacy", changefreq: "yearly", priority: "0.3" },
    { path: "/terms", changefreq: "yearly", priority: "0.3" },
    { path: "/refund", changefreq: "yearly", priority: "0.3" },
    { path: "/ai-safety", changefreq: "yearly", priority: "0.3" },
    { path: "/contact-support", changefreq: "yearly", priority: "0.4" },
    { path: "/getting-started", changefreq: "monthly", priority: "0.5" },
    { path: "/help", changefreq: "monthly", priority: "0.5" },
    { path: "/ai-image-generator", changefreq: "monthly", priority: "0.7" },
    { path: "/study-assistant", changefreq: "monthly", priority: "0.7" },
    { path: "/code-helper", changefreq: "monthly", priority: "0.7" },
    { path: "/ai-writer", changefreq: "monthly", priority: "0.7" },
    { path: "/research-assistant", changefreq: "monthly", priority: "0.7" },
    { path: "/chatgpt-alternative", changefreq: "monthly", priority: "0.7" },
    { path: "/ai-humanizer", changefreq: "monthly", priority: "0.7" },
    { path: "/humanize-ai-text", changefreq: "weekly", priority: "0.8" },
  ].map((entry) => Object.freeze(entry)),
);

const PUBLIC_REVIEW_PATHS = Object.freeze([
  ...PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path),
  ...[
    "features",
    "plans",
    "business",
    "enterprise",
    "education",
    "families",
    "developers",
    "use-cases",
    "learn",
    "shopping-assistant",
    "translation",
    "document-analysis",
    "about",
    "mission",
    "press",
    "brand",
    "security",
    "trust",
    "transparency",
    "model-behavior",
    "moderation",
    "data-controls",
    "accessibility",
  ].map((slug) => `/${slug}`),
  ...[
    "quickstart",
    "authentication",
    "api-reference",
    "models",
    "pricing",
    "usage-billing",
    "api-keys",
    "rate-limits",
    "errors",
    "streaming",
    "tool-calling",
    "image-generation",
    "files",
    "safety",
    "sdks",
    "examples",
    "migration-guides",
    "changelog",
    "status",
  ].map((slug) => `/developers/${slug}`),
  ...[
    "news",
    "product-updates",
    "engineering",
    "research",
    "safety-reports",
    "stories",
    "videos",
    "guides",
    "release-notes",
  ].map((section) => `/${section}`),
  "/changelog",
  "/engineering/server-owned-capabilities",
  "/safety-reports/truthful-preview-states",
  "/apps",
  "/assistants",
  ...["en", "es", "fr", "de", "pt-BR", "ja", "ko", "ar"].map((locale) => `/${locale}/home`),
]);

const PUBLIC_INDEXABLE_PATHS = new Set(PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path));
const NON_INDEXABLE_STATUSES = new Set(["error", "notFound", "redirected"]);

function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return "";
  }

  const [withoutQuery = ""] = pathname.split(/[?#]/u, 1);
  if (withoutQuery === "/") return "/";
  return withoutQuery.replace(/\/+$/u, "");
}

function isPublicIndexableRoute(pathname, statuses = []) {
  if (statuses.some((status) => NON_INDEXABLE_STATUSES.has(status))) return false;
  return PUBLIC_INDEXABLE_PATHS.has(normalizePathname(pathname));
}

function robotsDirectiveForRoute(pathname, statuses = []) {
  return isPublicIndexableRoute(pathname, statuses) ? "index, follow" : "noindex, nofollow";
}

export {
  PUBLIC_SITEMAP_ENTRIES,
  PUBLIC_REVIEW_PATHS,
  isPublicIndexableRoute,
  normalizePathname,
  robotsDirectiveForRoute,
};
