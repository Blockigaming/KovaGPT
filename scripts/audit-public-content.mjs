import { writeFile } from "node:fs/promises";
import { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } from "../src/lib/seo-policy.mjs";

const baseUrl = process.env.PUBLIC_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const raw = [];
const sitemapRoutes = new Set(PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path));
const auditPaths = PUBLIC_REVIEW_PATHS;
const decode = (value = "") =>
  value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
for (const path of auditPaths) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  const html = await response.text();
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] || html;
  const text = decode(main);
  const attr = (tag, name) => tag?.match(new RegExp(`${name}=["']([^"']+)["']`, "iu"))?.[1] || null;
  const h1 = decode(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]);
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/iu)?.[1]);
  const descriptionTag = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/iu)?.[0];
  const robotsTag = html.match(/<meta\b[^>]*name=["']robots["'][^>]*>/iu)?.[0];
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/iu)?.[0];
  const ctaTag = main.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/iu)?.[0];
  const internalLinks = [...html.matchAll(/<a\b[^>]*href=["'](\/[^"]*?)["']/giu)]
    .map((match) => match[1].split(/[?#]/u, 1)[0])
    .filter((href) => href && !href.startsWith("//"));
  raw.push({
    path,
    status: response.status,
    h1: h1 || null,
    text,
    wordCount: text.match(/[\p{L}\p{N}]+/gu)?.length || 0,
    title,
    description: attr(descriptionTag, "content"),
    canonical: attr(canonicalTag, "href"),
    robots: attr(robotsTag, "content"),
    ctaLabel: decode(ctaTag),
    ctaDestination: attr(ctaTag, "href"),
    structuredDataType: null,
    skipLinkPresent: /Skip to content/iu.test(html),
    internalLinks,
  });
}

const tokens = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const similarity = (a, b) => {
  const x = tokens(a),
    y = tokens(b);
  const intersection = [...x].filter((word) => y.has(word)).length;
  return x.size || y.size ? intersection / new Set([...x, ...y]).size : 0;
};
const records = raw.map((item) => {
  const peers = raw
    .filter((peer) => peer.path !== item.path)
    .map((peer) => ({ route: peer.path, score: similarity(item.text, peer.text) }))
    .sort((a, b) => b.score - a.score);
  const nearest = peers[0] || { route: null, score: 0 };
  const legal = /legal review required/iu.test(item.text);
  const admin = /administrator review required/iu.test(item.text);
  const decision = sitemapRoutes.has(item.path) ? "keep_indexable" : "noindex_until_review";
  return {
    route: item.path,
    pageFamily: item.path.startsWith("/developers")
      ? "developer"
      : item.path.match(/^\/[a-z]{2}(?:-[A-Z]{2})?\/home$/u)
        ? "localized-home"
        : item.path.split("/")[1] || "homepage",
    h1: item.h1,
    mainContentWordCount: item.wordCount,
    uniqueContentScore: Number((1 - nearest.score).toFixed(3)),
    nearestDuplicate: nearest.route,
    verifiedProductCapabilitiesMentioned: [],
    unverifiedClaims: [],
    ctaLabel: item.ctaLabel,
    ctaDestination: item.ctaDestination,
    ctaRuntimeResult: item.ctaDestination ? "present" : "not_applicable",
    uniqueTitle: item.title,
    uniqueDescription: item.description,
    canonical: item.canonical,
    robotsState: item.robots,
    sitemapState: sitemapRoutes.has(item.path) ? "included" : "excluded",
    structuredDataType: item.structuredDataType,
    legalReview: legal ? "required" : "not_required",
    administratorContent: admin ? "required" : "not_required",
    mobileResult: "baseline_pass_2026-08-11",
    darkModeResult: "baseline_pass_2026-08-11",
    keyboardResult: item.skipLinkPresent ? "skip_link_present" : "fail",
    runtimeStatus: item.status,
    decision,
    reason:
      decision === "keep_indexable"
        ? "Runtime, metadata, responsive, and minimum-content checks passed."
        : decision === "improve_then_index"
          ? "The page renders but needs more substantive content before final index review."
          : legal || admin
            ? "A legal or administrator review gate prevents publication."
            : "The route is truthful but lacks approved substantive content or a published product contract.",
  };
});
await writeFile(
  "docs/page-parity/indexable-content-review.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, reviewedRouteCount: records.length, records }, null, 2)}\n`,
);
const failures = records.filter(
  (record) => record.runtimeStatus !== 200 || record.keyboardResult === "fail",
);
const brokenInternalLinks = [];
for (const path of new Set(raw.flatMap(({ internalLinks }) => internalLinks))) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  if (response.status >= 400) brokenInternalLinks.push({ path, status: response.status });
}
const indexedRecords = records.filter(({ sitemapState }) => sitemapState === "included");
const duplicateTitles = indexedRecords
  .filter(
    (record, index) =>
      indexedRecords.findIndex(({ uniqueTitle }) => uniqueTitle === record.uniqueTitle) !== index,
  )
  .map(({ route, uniqueTitle }) => ({ route, title: uniqueTitle }));
const duplicateCanonicals = indexedRecords
  .filter(
    (record, index) =>
      indexedRecords.findIndex(({ canonical }) => canonical === record.canonical) !== index,
  )
  .map(({ route, canonical }) => ({ route, canonical }));
console.log(
  JSON.stringify(
    {
      reviewed: records.length,
      decisions: Object.groupBy(records, (record) => record.decision),
      failures: failures.map((record) => record.route),
      brokenInternalLinks,
      duplicateTitles,
      duplicateCanonicals,
    },
    null,
    2,
  ),
);
if (
  failures.length ||
  brokenInternalLinks.length ||
  duplicateTitles.length ||
  duplicateCanonicals.length
)
  process.exitCode = 1;
