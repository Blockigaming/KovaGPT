import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } from "../src/lib/seo-policy.mjs";

const root = "src/routes";
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? walk(join(directory, entry.name)) : join(directory, entry.name),
      ),
    )
  ).flat();
}

const review = JSON.parse(await readFile("docs/page-parity/indexable-content-review.json", "utf8"));
const reviewByPath = new Map(review.records.map((entry) => [entry.route, entry]));
const indexable = new Set(PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path));
const reviewed = new Set(PUBLIC_REVIEW_PATHS);
const files = (await walk(root)).filter((file) => /\.(?:ts|tsx)$/u.test(file)).sort();
const records = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const relativeFile = relative(root, file);
  const declared = source.match(/create(?:Root)?FileRoute\(["']([^"']+)["']\)/u)?.[1];
  const route =
    relativeFile === "__root.tsx" ? "<root-shell>" : declared || `<generated:${relativeFile}>`;
  const isDynamic = route.includes("$") || relativeFile.includes("$");
  const isService = /^\/(?:api|\.mcp|\.well-known|mcp)(?:\/|$)/u.test(route);
  const isReserved =
    /^\/(?:auth|login|signup|reset-password|oauth|checkout|email|unsubscribe)(?:\/|$)/u.test(route);
  const isReviewed = reviewed.has(route);
  const classification = isService
    ? "reserved_service"
    : isReserved
      ? "reserved_auth_or_callback"
      : isDynamic
        ? "dynamic"
        : isReviewed
          ? "public"
          : route === "<root-shell>"
            ? "root_shell"
            : "application_or_authenticated";
  const contentReview = reviewByPath.get(route);
  records.push({
    canonicalPath: route,
    routeFile: file,
    template: isDynamic,
    classification,
    indexingDecision: indexable.has(route) ? "index" : "noindex_or_not_public",
    sitemapIncluded: indexable.has(route),
    canonicalUrl: isReviewed ? `https://kovagpt.com${route === "/" ? "/" : route}` : null,
    contentOwner: isReviewed
      ? "KovaGPT public content registry or explicit route"
      : "route subsystem owner",
    contentSource: isReviewed ? "repository-owned source" : relativeFile,
    contentCompleteness: contentReview?.decision || "fixture_or_contract_dependent",
    legalReviewRequired: contentReview?.legalReview === "required",
    administratorContentRequired: contentReview?.administratorContent === "required",
    runtimeResult: contentReview
      ? `http_${contentReview.runtimeStatus}`
      : "not_crawled_requires_fixture",
    metadataResult: contentReview ? "reviewed" : "not_applicable_or_fixture_required",
    authorizationBoundary: isService
      ? "server handler authorization; public catch-all prohibited"
      : isReserved
        ? "dedicated authentication/callback route; public catch-all prohibited"
        : isReviewed
          ? "signed-out public response"
          : "application route; authentication and ownership remain route-specific",
    finalDecision: indexable.has(route)
      ? "retain_in_sitemap"
      : isReviewed
        ? "retain_noindex"
        : "retain_route_outside_public_sitemap",
    evidence: [
      file,
      contentReview ? "docs/page-parity/indexable-content-review.json" : "npm run build",
    ],
  });
}

const counts = Object.fromEntries(
  Object.entries(Object.groupBy(records, ({ classification }) => classification)).map(
    ([key, value]) => [key, value.length],
  ),
);
await writeFile(
  "docs/release-reconciliation/canonical-route-manifest.json",
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: "2026-08-12",
      sourceOfTruth: "src/routes plus src/lib/seo-policy.mjs",
      routeFileCount: records.length,
      sitemapCount: PUBLIC_SITEMAP_ENTRIES.length,
      reviewedPublicRouteCount: PUBLIC_REVIEW_PATHS.length,
      classificationCounts: counts,
      records,
    },
    null,
    2,
  )}\n`,
);
console.log({ routeFiles: records.length, sitemap: PUBLIC_SITEMAP_ENTRIES.length, counts });
