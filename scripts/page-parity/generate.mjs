import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const commit = "93ebe7b2";
const added = execFileSync("git", ["show", "--pretty=format:", "--name-status", commit], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .filter(
    ([status, file]) => status === "A" && file.startsWith("src/routes/") && file.endsWith(".tsx"),
  )
  .map(([, file]) => file);
const sitemapSource = readFileSync("src/lib/seo-policy.mjs", "utf8");
const sitemapPaths = [...sitemapSource.matchAll(/(?:"path"|path):\s*"([^"]+)"/g)].map(
  (match) => match[1],
);
const redirectFiles = new Set([
  "src/routes/chat.tsx",
  "src/routes/new.tsx",
  "src/routes/search.tsx",
  "src/routes/canvas.$documentId.tsx",
  "src/routes/developers.api-keys.tsx",
  "src/routes/developers.billing.tsx",
  "src/routes/developers.changelog.tsx",
  "src/routes/developers.status.tsx",
  "src/routes/developers.usage.tsx",
]);
const legal = new Set([
  "/acceptable-use",
  "/cookie-policy",
  "/data-processing",
  "/copyright",
  "/law-enforcement",
  "/regional-notices",
  "/developers/terms",
  "/developers/policies",
]);
const admin = new Set(["/leadership", "/partners", "/customer-stories"]);
const publishing = new Set(
  "engineering updates release-notes research safety-evaluations technical-reports tutorials guides case-studies announcements news videos".split(
    " ",
  ),
);
const rows = [];
for (const file of added) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/createFileRoute\("([^"]+)"\)/);
  if (!match) continue;
  const route = match[1];
  const dynamic = route.includes("$");
  rows.push({
    route,
    routeFile: file,
    kind: dynamic ? "dynamic_template" : "static",
    indexing: sitemapPaths.includes(route) ? "index" : "noindex",
    authentication: redirectFiles.has(file) ? "redirect_to_workspace" : "public",
    legalReview: legal.has(route),
    administratorContent: admin.has(route),
    publishingIndex: publishing.has(route.slice(1)),
    intentional404: dynamic && publishing.has(route.split("/")[1]),
    runtimeVerification: "pending",
    metadataVerification: dynamic ? "not_indexable" : "static_verified",
  });
}
const expansions = [
  ..."collaboration data design developer-tools file-sharing finance go-to-market project-management productivity education communication research"
    .split(" ")
    .map((slug) => ({
      route: `/apps/${slug}`,
      template: "/apps/$category",
      kind: "validated_category",
      indexing: "noindex",
    })),
  ..."study-coach writing-partner code-reviewer".split(" ").map((slug) => ({
    route: `/assistants/${slug}`,
    template: "/assistants/$assistantSlug",
    kind: "validated_assistant",
    indexing: "noindex",
  })),
];
const manifest = {
  generatedAt: "2026-08-11",
  sourceCommit: commit,
  counts: {
    addedRouteFiles: rows.length,
    staticRouteFiles: rows.filter((r) => r.kind === "static").length,
    dynamicRouteFiles: rows.filter((r) => r.kind === "dynamic_template").length,
    indexableAddedRoutes: rows.filter((r) => r.indexing === "index").length,
    noindexAddedRoutes: rows.filter((r) => r.indexing === "noindex").length,
    publicNoindexRoutes: rows.filter(
      (r) => r.indexing === "noindex" && r.authentication === "public",
    ).length,
    authenticatedRedirects: rows.filter((r) => r.authentication === "redirect_to_workspace").length,
    privateDynamicRoutes: rows.filter((r) =>
      ["/share/$shareId", "/canvas/$documentId"].includes(r.route),
    ).length,
    validatedCategoryRoutes: 12,
    validatedAssistantRoutes: 3,
    publishingIndexes: rows.filter((r) => r.publishingIndex).length,
    publishingDetailTemplates: rows.filter((r) => r.intentional404).length,
    intentional404Templates: rows.filter((r) => r.intentional404).length,
    legalReviewRoutes: rows.filter((r) => r.legalReview).length,
    administratorContentRoutes: rows.filter((r) => r.administratorContent).length,
    localeRoutes: rows.filter((r) => r.route === "/en").length,
    sitemapEntries: sitemapPaths.length,
  },
  routes: rows,
  expandedDynamicRoutes: expansions,
  sitemapPaths,
};
writeFileSync(
  "docs/page-parity/kova-route-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);

await import("./snapshot-inventory.mjs");
console.log(JSON.stringify(manifest.counts, null, 2));
