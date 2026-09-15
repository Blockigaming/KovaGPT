import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  auditCatalog,
  normalizedPath,
  recordFingerprint,
  validateEvidence,
  validateRecord,
  validateRenderedFacts,
} from "../../scripts/publication/contract.mjs";
import { buildPublicationReport } from "../../scripts/publication/audit.mjs";

const now = Date.parse("2026-09-15T12:00:00Z");
const valid = () => ({
  path: "/example",
  template: "detail",
  source: "test-fixture",
  title: "A complete example",
  eyebrow: "Test fixture",
  description: "A deliberately synthetic example for publication contract regression tests.",
  summary: "Original example content.",
  highlights: ["Clear limits"],
  primaryAction: { label: "Start", to: "/" },
  sections: [
    { title: "First section", body: "First complete paragraph." },
    { title: "Second section", body: "Second complete paragraph." },
  ],
});
const routes = new Set(["/", "/example", "/second"]);
const capabilities = new Map([
  ["maps", { publicStatus: "release-gated", productionVerified: false }],
  ["chat", { publicStatus: "configuration-dependent", productionVerified: false }],
]);
const options = { routes, capabilityById: capabilities };
function facts(record = valid()) {
  return {
    status: 200,
    mainCount: 1,
    h1Count: 1,
    h1: record.title,
    title: `${record.title} | KovaGPT`,
    description: record.description,
    canonicalCount: 1,
    canonical: `https://kovagpt.com${record.path}`,
    navigation: true,
    footer: true,
    brokenLinks: [],
    brokenImages: [],
    runtimeErrors: [],
    overflowPx: 0,
    structuredDataChecked: true,
    structuredDataErrors: [],
  };
}
function evidence(record = valid()) {
  const base = {
    status: "pass",
    fingerprint: recordFingerprint(record, "dependency"),
    checkedAt: new Date(now).toISOString(),
    reference: "fixture-only-evidence",
  };
  return {
    render: { ...base, facts: facts(record) },
    editorial: { ...base, reviewer: "Synthetic test reviewer", capabilityClaimsReviewed: true },
    accessibility: {
      ...base,
      checks: Object.fromEntries(
        ["keyboard", "focus", "semantics", "contrast", "reduced-motion"].map((name) => [
          name,
          "pass",
        ]),
      ),
    },
    responsive: {
      ...base,
      cases: [320, 390, 768, 1024, 1280, 1440, 1728].flatMap((width) =>
        ["light", "dark"].flatMap((theme) =>
          [1, 2].map((textScale) => ({ width, theme, textScale, status: "pass" })),
        ),
      ),
    },
  };
}
const audit = (record = valid(), proof = evidence(record), extra = {}) =>
  auditCatalog({
    records: [record],
    reviewPaths: [record.path],
    sitemapPaths: [record.path],
    routes,
    capabilityById: capabilities,
    dependencyFingerprint: "dependency",
    evidence: { [record.path]: proof },
    now,
    ...extra,
  });

test("complete synthetic contract and complete bound evidence pass", () => {
  assert.deepEqual(validateRecord(valid(), options), []);
  assert.deepEqual(validateRenderedFacts(facts(), valid()), []);
  assert.deepEqual(validateEvidence(evidence(), recordFingerprint(valid(), "dependency"), now), []);
  assert.equal(audit().counts.publishReady, 1);
});
for (const [name, mutate, expected] of [
  ["missing title", (r) => delete r.title, "missing-title"],
  ["short metadata", (r) => (r.description = "Too short"), "description-too-short"],
  ["placeholder", (r) => (r.summary = "TODO write copy"), "placeholder-content"],
  ["missing sections", (r) => (r.sections = []), "missing-content-sections"],
  ["malformed section", (r) => (r.sections[0] = null), "incomplete-section:0"],
  ["malformed FAQ", (r) => (r.faq = {}), "invalid-faq"],
  ["empty FAQ", (r) => (r.faq = [null]), "incomplete-faq:0"],
  ["malformed links", (r) => (r.relatedPages = false), "invalid-relatedPages"],
  ["missing route", (r) => (r.path = "/missing"), "missing-route-implementation"],
  ["unknown template", (r) => (r.template = "made-up"), "unknown-template"],
  [
    "broken CTA",
    (r) => (r.primaryAction.to = "/missing"),
    "primary-action:unknown-internal-destination",
  ],
  [
    "unsafe CTA",
    (r) => (r.primaryAction.to = "javascript:alert(1)"),
    "primary-action:unapproved-destination",
  ],
  [
    "protocol-relative CTA",
    (r) => (r.primaryAction.to = "//evil.invalid"),
    "primary-action:unknown-internal-destination",
  ],
  [
    "backend CTA",
    (r) => (r.primaryAction.to = "/api/chat"),
    "primary-action:unknown-internal-destination",
  ],
  [
    "unsupported live claim",
    (r) => (r.capabilityClaims = [{ id: "chat", kind: "live" }]),
    "unverified-live-claim:chat",
  ],
  [
    "gated capability",
    (r) => (r.capabilityClaims = [{ id: "maps", kind: "conditional" }]),
    "blocked-capability-claim:maps",
  ],
  [
    "unknown capability",
    (r) => (r.capabilityClaims = [{ id: "imaginary", kind: "live" }]),
    "unknown-capability:imaginary",
  ],
  ["malformed claim", (r) => (r.capabilityClaims = [null]), "malformed-capability-claim"],
])
  test(`publication contract rejects ${name}`, () => {
    const r = valid();
    mutate(r);
    assert.ok(validateRecord(r, options).includes(expected));
  });

for (const [name, mutate] of [
  ["HTTP error", (f) => (f.status = 404)],
  ["missing H1", (f) => (f.h1Count = 0)],
  ["multiple mains", (f) => (f.mainCount = 2)],
  ["missing title", (f) => (f.title = "")],
  ["wrong canonical", (f) => (f.canonical = "https://wrong.invalid")],
  ["wrong content", (f) => (f.h1 = "Wrong page")],
  ["missing navigation", (f) => (f.navigation = false)],
  ["missing footer", (f) => (f.footer = false)],
  ["broken link", (f) => (f.brokenLinks = ["/missing"])],
  ["unchecked images", (f) => delete f.brokenImages],
  ["runtime error", (f) => (f.runtimeErrors = ["TypeError"])],
  ["overflow", (f) => (f.overflowPx = 20)],
  ["unchecked JSON-LD", (f) => delete f.structuredDataErrors],
])
  test(`render observations reject ${name}`, () => {
    const f = facts();
    mutate(f);
    assert.ok(validateRenderedFacts(f, valid()).length > 0);
  });
for (const [name, mutate] of [
  ["missing evidence", (e) => delete e.render],
  ["cancelled evidence", (e) => (e.render.status = "cancelled")],
  ["skipped evidence", (e) => (e.render.status = "skipped")],
  ["stale source", (e) => (e.render.fingerprint = "old")],
  ["future evidence", (e) => (e.render.checkedAt = "2099-01-01T00:00:00Z")],
  ["expired evidence", (e) => (e.render.checkedAt = "2025-01-01T00:00:00Z")],
  ["unreviewed claims", (e) => (e.editorial.capabilityClaimsReviewed = false)],
  ["missing reviewer", (e) => (e.editorial.reviewer = "")],
  ["incomplete viewport matrix", (e) => e.responsive.cases.pop()],
  ["malformed viewport matrix", (e) => (e.responsive.cases = { success: true })],
  ["missing keyboard check", (e) => delete e.accessibility.checks.keyboard],
])
  test(`evidence rejects ${name}`, () => {
    const e = evidence();
    mutate(e);
    assert.ok(validateEvidence(e, recordFingerprint(valid(), "dependency"), now).length > 0);
  });

test("missing render observations and duplicate content cannot be publication-ready", () => {
  const e = evidence();
  delete e.render.facts;
  assert.equal(audit(valid(), e).counts.publishReady, 0);
  const first = valid(),
    second = { ...valid(), path: "/second" };
  const report = audit(first, evidence(first), {
    records: [first, second],
    reviewPaths: [first.path, second.path],
  });
  assert.ok(report.results.every((row) => row.errors.includes("duplicate-page-content")));
});
test("missing adapters, ambiguous paths, sitemap omissions and admin review fail closed", () => {
  assert.equal(audit(valid(), evidence(), { records: [] }).counts.adapted, 0);
  assert.ok(
    audit(valid(), evidence(), { records: [valid(), valid()] }).results[0].errors.includes(
      "ambiguous-content-records",
    ),
  );
  const r = { ...valid(), indexable: true, review: "legal" };
  const out = audit(r, evidence(r), { sitemapPaths: [] });
  assert.ok(out.results[0].errors.includes("missing-sitemap-entry"));
  assert.ok(out.results[0].errors.includes("legal-approval-required"));
  assert.throws(() => auditCatalog({ records: [], reviewPaths: [] }), /Empty/);
});
test("fingerprints change with source, content or dependency changes", () => {
  assert.notEqual(recordFingerprint(valid(), "a"), recordFingerprint(valid(), "b"));
  assert.notEqual(
    recordFingerprint(valid(), "a"),
    recordFingerprint({ ...valid(), title: "Changed" }, "a"),
  );
});
test("URL normalization rejects traversal, credentials, queries and control characters", () => {
  for (const path of [
    null,
    {},
    "//evil.invalid",
    "/a/../b",
    "/a?b",
    "/a#b",
    "/bad\\path",
    "/new\nline",
  ])
    assert.equal(normalizedPath(path), null);
  assert.equal(normalizedPath("/example/"), "/example");
});
test("real source inventory is deterministic and never invents missing QA", () => {
  const { report, capabilities } = buildPublicationReport(process.cwd(), {}, now);
  assert.ok(report.counts.routes > 500);
  assert.ok(report.counts.adapted > 400);
  assert.equal(report.counts.publishReady, 0);
  assert.equal(report.counts.blocked, report.counts.routes);
  assert.equal(capabilities.productionVerifiedCount, 0);
  assert.equal(
    buildPublicationReport(process.cwd(), {}, now).report.dependencyFingerprint,
    report.dependencyFingerprint,
  );
});
test("CLI writes inspectable artifacts; strict publication exits nonzero with absent evidence", () => {
  const out = mkdtempSync(join(tmpdir(), "kova-publication-"));
  try {
    const run = (args) =>
      spawnSync(process.execPath, ["scripts/publication/audit.mjs", "--out", out, ...args], {
        encoding: "utf8",
        timeout: 30000,
      });
    assert.equal(run(["--audit-only"]).status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(out, "readiness.json"), "utf8")).counts.publishReady,
      0,
    );
    assert.equal(run([]).status, 1);
    assert.notEqual(run(["--invent-a-pass"]).status, 0);
    assert.notEqual(run(["--evidence"]).status, 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("render collector refuses production hosts, credentials, paths and non-web schemes", async () => {
  const { localPreviewOrigin } = await import("../../scripts/publication/render.mjs");
  for (const value of [
    "https://kovagpt.com",
    "http://127.0.0.1/private",
    "http://user:secret@localhost",
    "file:///etc/passwd",
    "http://localhost?token=x",
  ])
    assert.throws(() => localPreviewOrigin(value));
  assert.equal(localPreviewOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
});
