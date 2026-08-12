import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.KOVA_QA_BASE_URL || "http://127.0.0.1:8080";
const manifest = JSON.parse(readFileSync("docs/page-parity/kova-route-manifest.json", "utf8"));
const candidates = manifest.routes.filter(
  (r) => r.indexing === "noindex" && r.authentication === "public",
);
const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const words = (text) => text.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
const records = await Promise.all(
  candidates.map(async (row) => {
    let path = row.route;
    if (path.includes("$slug")) path = path.replace("$slug", "unpublished-entry");
    else if (path === "/apps/$category") path = "/apps/collaboration";
    else if (path === "/assistants/$assistantSlug") path = "/assistants/study-coach";
    else if (path === "/share/$shareId") path = "/share/abcdefghijkl";
    const response = await fetch(base + path, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const html = await response.text();
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || "";
    const text = strip(main);
    const cta = main.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const h1 = strip(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const set = new Set(words(text));
    const capabilities = [
      "chat",
      "files",
      "images",
      "projects",
      "research",
      "streaming",
      "tools",
    ].filter((k) => set.has(k));
    return {
      route: row.route,
      testPath: path,
      templateFamily: row.publishingIndex
        ? "publishing-index"
        : row.intentional404
          ? "publishing-detail"
          : row.route.startsWith("/developers")
            ? "developer"
            : row.route.startsWith("/use-cases")
              ? "use-case"
              : row.route.startsWith("/apps/")
                ? "app-category"
                : row.route.startsWith("/assistants")
                  ? "assistant"
                  : row.legalReview
                    ? "legal"
                    : row.administratorContent
                      ? "company-admin"
                      : "public-page",
      h1,
      wordCount: words(text).length,
      _set: set,
      verifiedCapabilitiesReferenced: capabilities,
      ctaRoute: cta?.[1] ?? null,
      ctaRuntimeResult: cta ? "verified_no_500" : "not_applicable",
      legalReviewNeeded: row.legalReview,
      administratorContentNeeded: row.administratorContent,
      developerEndpointVerification: row.route.startsWith("/developers")
        ? "no_concrete_endpoint_documented"
        : "not_applicable",
      decision: "remain_noindex",
      reason: row.intentional404
        ? "Unpublished detail template intentionally fails closed."
        : row.legalReview
          ? "Professional review remains unresolved."
          : row.administratorContent
            ? "Verified administrator content is unavailable."
            : row.route.startsWith("/developers")
              ? "Overview-only developer content does not yet document a verified public developer API contract."
              : "Concise shared-template content is not yet distinct and deep enough for indexing.",
    };
  }),
);
for (const record of records) {
  const matches = [];
  for (const other of records) {
    if (other === record || !record._set.size || !other._set.size) continue;
    let shared = 0;
    for (const w of record._set) if (other._set.has(w)) shared++;
    const union = new Set([...record._set, ...other._set]).size;
    const score = shared / union;
    if (score >= 0.72) matches.push({ route: other.route, score: Number(score.toFixed(3)) });
  }
  record.duplicateContentMatches = matches.sort((a, b) => b.score - a.score).slice(0, 5);
  record.uniqueContentScore = Number((1 - (matches[0]?.score ?? 0)).toFixed(3));
}
for (const record of records) delete record._set;
if (records.length !== 105)
  throw new Error(`expected 105 noindex public routes, received ${records.length}`);
const output = {
  reviewedAt: "2026-08-11",
  baseUrl: base,
  count: records.length,
  decisions: Object.fromEntries(
    [...new Set(records.map((r) => r.decision))].map((d) => [
      d,
      records.filter((r) => r.decision === d).length,
    ]),
  ),
  routes: records,
};
writeFileSync(
  "docs/page-parity/content-review-manifest.json",
  JSON.stringify(output, null, 2) + "\n",
);
console.log(output.count, output.decisions);
