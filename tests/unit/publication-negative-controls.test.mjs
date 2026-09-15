import assert from "node:assert/strict";
import test from "node:test";
import { validateEvidence, validateRecord } from "../../scripts/publication/contract.mjs";

const record = {
  path: "/example",
  template: "landing",
  title: "Example",
  eyebrow: "Synthetic fixture",
  description: "A synthetic record for checking publication validation, not a real page.",
  summary: "Synthetic content.",
  sections: [
    { title: "One", body: "First section." },
    { title: "Two", body: "Second section." },
  ],
};
const options = { routes: new Set(["/", "/example"]) };

test("an explicitly supplied landing action cannot bypass destination validation", () => {
  assert.deepEqual(validateRecord(record, options), []);
  assert.deepEqual(
    validateRecord({ ...record, primaryAction: { label: "Open", to: "/" } }, options),
    [],
  );
  for (const to of ["javascript:alert(1)", "/missing", "//example.invalid"]) {
    assert.ok(
      validateRecord({ ...record, primaryAction: { label: "Open", to } }, options).some(
        (error) => error.startsWith("primary-action:"),
      ),
      to,
    );
  }
});

function completeEvidence() {
  const base = {
    status: "pass",
    fingerprint: "fixture",
    checkedAt: "2026-09-15T12:00:00Z",
    reference: "synthetic-negative-control",
  };
  return {
    render: { ...base },
    editorial: { ...base, reviewer: "Test fixture", capabilityClaimsReviewed: true },
    accessibility: {
      ...base,
      checks: Object.fromEntries(
        ["keyboard", "focus", "semantics", "contrast", "reduced-motion"].map((key) => [
          key,
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
const now = Date.parse("2026-09-15T12:01:00Z");

test("failed or malformed responsive observations cannot be hidden by a complete passing subset", () => {
  assert.deepEqual(validateEvidence(completeEvidence(), "fixture", now), []);
  for (const status of ["fail", "skipped", "cancelled", undefined]) {
    const proof = completeEvidence();
    proof.responsive.cases.push({ ...proof.responsive.cases[0], status });
    assert.ok(validateEvidence(proof, "fixture", now).length > 0, String(status));
  }
  const proof = completeEvidence();
  proof.responsive.cases.push(null);
  assert.ok(validateEvidence(proof, "fixture", now).length > 0);
});

test("repeated successful observations from multiple browsers remain usable", () => {
  const proof = completeEvidence();
  proof.responsive.cases.push({ ...proof.responsive.cases[0], browser: "firefox" });
  assert.deepEqual(validateEvidence(proof, "fixture", now), []);
});
