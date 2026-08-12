import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidence = JSON.parse(readFileSync("docs/page-parity/runtime-results.json", "utf8"));
const manifest = JSON.parse(readFileSync("docs/page-parity/kova-route-manifest.json", "utf8"));

test("recorded production-preview route audit has no HTTP 500 or failed case", () => {
  assert.equal(evidence.total, 119);
  assert.equal(evidence.passed, evidence.total);
  assert.deepEqual(evidence.failed, []);
  assert.equal(
    evidence.results.some((result) => result.status >= 500),
    false,
  );
});

test("every added route has recorded runtime evidence", () => {
  const verified = new Set(evidence.results.map((result) => result.route));
  for (const route of manifest.routes) assert.ok(verified.has(route.route), route.route);
});

test("unknown dynamic identifiers fail closed in recorded runtime evidence", () => {
  assert.equal(evidence.results.find((result) => result.route === "/maps")?.status, 200);
  for (const route of ["/apps/not-real", "/assistants/not-real", "/share/bad", "/canvas/bad"])
    assert.equal(evidence.results.find((result) => result.route === route)?.status, 404, route);
  for (const result of evidence.results.filter((entry) => entry.route.includes("/$slug")))
    assert.equal(result.status, 404, result.route);
});

test("rendered public pages have one H1 and noindex metadata", () => {
  const redirects = new Set(
    manifest.routes
      .filter((route) => route.authentication === "redirect_to_workspace")
      .map((route) => route.route),
  );
  for (const result of evidence.results.filter(
    (entry) => entry.status === 200 && !redirects.has(entry.route),
  )) {
    assert.equal(result.h1, 1, result.route);
    assert.match(result.robots ?? "", /^noindex/, result.route);
  }
});
