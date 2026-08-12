import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const matrix = JSON.parse(readFileSync("docs/product-parity/feature-parity-matrix.json", "utf8"));

test("product parity matrix has one evidence-backed disposition per audited journey", () => {
  assert.equal(matrix.features.length, 49);
  assert.deepEqual(matrix.totals, {
    complete: 33,
    partial: 8,
    missing: 3,
    "intentionally different": 2,
    blocked: 1,
    excluded: 2,
  });
  assert.equal(new Set(matrix.features.map((feature) => feature.id)).size, 49);
  for (const feature of matrix.features) {
    for (const key of [
      "surface",
      "journey",
      "state",
      "entitlement",
      "kovaBehavior",
      "visualDifference",
      "functionalDifference",
      "accessibilityDifference",
      "securityPrivacyImpact",
      "decision",
      "evidence",
      "referenceObservedAt",
      "referenceEvidence",
    ])
      assert.ok(Object.hasOwn(feature, key), `${feature.id}: ${key}`);
  }
});

test("matrix does not misrepresent unavailable live reference behavior as observed", () => {
  assert.match(matrix.referenceMethod, /not accessed/);
  assert.ok(
    matrix.features.every(
      (feature) => feature.referenceEvidence === "unavailable_private_or_network_blocked",
    ),
  );
});
