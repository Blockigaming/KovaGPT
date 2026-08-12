import { readFileSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:8080";
const manifest = JSON.parse(readFileSync("docs/page-parity/kova-route-manifest.json"));
const cases = manifest.routes.map((row) => {
  let path = row.route,
    expected = 200;
  if (path.includes("$")) {
    if (row.intentional404) {
      path = path.replace("$slug", "unpublished-entry");
      expected = 404;
    } else if (path === "/apps/$category") path = "/apps/collaboration";
    else if (path === "/assistants/$assistantSlug") path = "/assistants/study-coach";
    else if (path === "/share/$shareId") path = "/share/abcdefghijkl";
    else if (path === "/canvas/$documentId") path = "/canvas/abcdef";
  }
  return { row, path, expected };
});
for (const [path, expected] of [
  ["/maps", 200],
  ["/apps/not-real", 404],
  ["/assistants/not-real", 404],
  ["/share/bad", 404],
  ["/canvas/bad", 404],
])
  cases.push({ row: { route: path }, path, expected });
const results = await Promise.all(
  cases.map(async ({ row, path, expected }) => {
    try {
      const response = await fetch(base + path, {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      const html = await response.text();
      const h1 = (html.match(/<h1\b/g) || []).length;
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
      const canonical =
        html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/)?.[1] ?? null;
      const robots =
        html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/)?.[1] ?? null;
      const pass =
        expected === 404
          ? response.status === 404
          : response.status < 500 && (row.authentication === "redirect_to_workspace" || h1 === 1);
      return {
        route: row.route,
        testPath: path,
        status: response.status,
        expected,
        h1,
        title,
        canonical,
        robots,
        pass,
      };
    } catch (error) {
      return {
        route: row.route,
        testPath: path,
        status: 0,
        expected,
        pass: false,
        error: String(error),
      };
    }
  }),
);
const output = {
  baseUrl: base,
  checkedAt: "2026-08-11",
  total: results.length,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass),
  results,
};
writeFileSync("docs/page-parity/runtime-results.json", JSON.stringify(output, null, 2) + "\n");
console.log(`verified ${output.passed}/${output.total}`);
if (output.failed.length) {
  console.error(output.failed);
  process.exit(1);
}
