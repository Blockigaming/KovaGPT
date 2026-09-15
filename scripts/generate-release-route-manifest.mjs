import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } from "../src/lib/seo-policy.mjs";

const root = "src/routes";
const generatedAt =
  process.env.KOVA_ROUTE_MANIFEST_DATE?.trim() || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/u.test(generatedAt)) {
  throw new Error("KOVA_ROUTE_MANIFEST_DATE must use YYYY-MM-DD");
}
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
const routeSources = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(file, "utf8");
    const relativeFile = relative(root, file);
    const declared = source.match(/create(?:Root)?FileRoute\(["']([^"']+)["']\)/u)?.[1];
    const route =
      relativeFile === "__root.tsx" ? "<root-shell>" : declared || `<generated:${relativeFile}>`;
    return { file, relativeFile, route };
  }),
);
const declaredRoutes = new Set(routeSources.map(({ route }) => route));

function matchesTemplate(template, path) {
  const templateSegments = template.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  return (
    templateSegments.length === pathSegments.length &&
    templateSegments.every(
      (segment, index) => segment.startsWith("$") || segment === pathSegments[index],
    )
  );
}

const records = [];
for (const { file, relativeFile, route } of routeSources) {
  const isDynamic = route.includes("$") || relativeFile.includes("$");
  const resolvedCanonicalPaths = isDynamic
    ? [...indexable]
        .filter((path) => !declaredRoutes.has(path) && matchesTemplate(route, path))
        .sort()
    : [];
  const resolvedPathEvidence = resolvedCanonicalPaths.map((path) => {
    const pathReview = reviewByPath.get(path);
    if (!pathReview) {
      throw new Error(`Missing public content review evidence for ${path} resolved by ${route}`);
    }
    return {
      canonicalPath: path,
      canonicalUrl: `https://kovagpt.com${path === "/" ? "/" : path}`,
      contentCompleteness: pathReview.decision,
      legalReviewRequired: pathReview.legalReview === "required",
      administratorContentRequired: pathReview.administratorContent === "required",
      runtimeResult: `http_${pathReview.runtimeStatus}`,
      metadataResult: "reviewed",
      finalDecision: "retain_in_sitemap",
      evidence: [file, "docs/page-parity/indexable-content-review.json"],
    };
  });
  const indexesResolvedPaths = resolvedCanonicalPaths.length > 0;
  const isService = /^\/(?:api|\.mcp|\.well-known|mcp)(?:\/|$)/u.test(route);
  const isReserved =
    /^\/(?:auth|login|signup|reset-password|oauth|checkout|email|unsubscribe)(?:\/|$)/u.test(route);
  const isReviewed = reviewed.has(route);
  const classification = isService
    ? "reserved_service"
    : isReserved
      ? "reserved_auth_or_callback"
      : isDynamic
        ? indexesResolvedPaths
          ? "dynamic_public"
          : "dynamic"
        : isReviewed
          ? "public"
          : route === "<root-shell>"
            ? "root_shell"
            : "application_or_authenticated";
  const contentReview = reviewByPath.get(route);
  records.push({
    canonicalPath: route,
    resolvedCanonicalPaths,
    resolvedPathEvidence,
    routeFile: file,
    template: isDynamic,
    classification,
    indexingDecision: indexable.has(route)
      ? "index"
      : indexesResolvedPaths
        ? "index_resolved_paths"
        : "noindex_or_not_public",
    sitemapIncluded: indexable.has(route),
    canonicalUrl: isReviewed ? `https://kovagpt.com${route === "/" ? "/" : route}` : null,
    contentOwner:
      isReviewed || indexesResolvedPaths
        ? "KovaGPT public content registry or explicit route"
        : "route subsystem owner",
    contentSource: isReviewed
      ? "repository-owned source"
      : indexesResolvedPaths
        ? "resolved path evidence attached"
        : relativeFile,
    contentCompleteness:
      contentReview?.decision ||
      (indexesResolvedPaths ? "see_resolved_path_evidence" : "fixture_or_contract_dependent"),
    legalReviewRequired:
      contentReview?.legalReview === "required" ||
      resolvedPathEvidence.some(({ legalReviewRequired }) => legalReviewRequired),
    administratorContentRequired:
      contentReview?.administratorContent === "required" ||
      resolvedPathEvidence.some(({ administratorContentRequired }) => administratorContentRequired),
    runtimeResult: contentReview
      ? `http_${contentReview.runtimeStatus}`
      : indexesResolvedPaths
        ? "see_resolved_path_evidence"
        : "not_crawled_requires_fixture",
    metadataResult: contentReview
      ? "reviewed"
      : indexesResolvedPaths
        ? "see_resolved_path_evidence"
        : "not_applicable_or_fixture_required",
    authorizationBoundary: isService
      ? "server handler authorization; public catch-all prohibited"
      : isReserved
        ? "dedicated authentication/callback route; public catch-all prohibited"
        : isReviewed || indexesResolvedPaths
          ? "signed-out public response"
          : "application route; authentication and ownership remain route-specific",
    finalDecision: indexable.has(route)
      ? "retain_in_sitemap"
      : indexesResolvedPaths
        ? "retain_resolved_paths_in_sitemap"
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
      schemaVersion: 2,
      generatedAt,
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
