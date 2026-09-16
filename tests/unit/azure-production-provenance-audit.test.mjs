import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateProductionProvenanceEvidence } from "../../scripts/azure/production-provenance-audit.mjs";

const image = `kovagptacr.azurecr.io/kovagpt@sha256:${"a".repeat(64)}`;
const app = { image, latestRevision: "kovagpt-prod-web--abc" };
const revisions = [
  { name: app.latestRevision, active: true, traffic: 100, image },
  {
    name: "kovagpt-prod-web--old",
    active: false,
    traffic: 0,
    image: `kovagptacr.azurecr.io/kovagpt@sha256:${"b".repeat(64)}`,
  },
];

const validate = validateProductionProvenanceEvidence;

test("accepts one immutable serving production image with 100 percent traffic", () => {
  assert.deepEqual(validate(app, revisions, image), {
    image,
    latestRevision: app.latestRevision,
    activeRevisionCount: 1,
    servingRevisions: [app.latestRevision],
    trafficTotal: 100,
  });
});

test("rejects mutable production image tags", () => {
  const invalid = { ...app, image: "kovagptacr.azurecr.io/kovagpt:latest" };
  assert.throws(() => validate(invalid, revisions), /production_provenance_image_not_immutable/u);
});

test("rejects a running image that differs from the approved digest", () => {
  const expected = `kovagptacr.azurecr.io/kovagpt@sha256:${"c".repeat(64)}`;
  assert.throws(() => validate(app, revisions, expected), /production_provenance_image_mismatch/u);
});

test("rejects incomplete production traffic", () => {
  const invalid = [{ ...revisions[0], traffic: 90 }];
  assert.throws(() => validate(app, invalid), /production_provenance_traffic_total_invalid/u);
});

test("rejects traffic sent to a revision using another image", () => {
  const invalid = [
    { ...revisions[0], traffic: 50 },
    { ...revisions[1], active: true, traffic: 50 },
  ];
  assert.throws(() => validate(app, invalid), /production_provenance_serving_image_mismatch/u);
});

test("rejects evidence where the latest revision receives no traffic", () => {
  const invalid = { ...app, latestRevision: "kovagpt-prod-web--new" };
  assert.throws(
    () => validate(invalid, revisions),
    /production_provenance_latest_revision_not_serving/u,
  );
});

test("rejects an inactive serving revision even when another revision is active", () => {
  const invalid = [
    { ...revisions[0], active: false },
    { ...revisions[1], active: true },
  ];
  assert.throws(() => validate(app, invalid), /production_provenance_serving_revision_inactive/u);
});

for (const traffic of [NaN, Infinity, "invalid", "0", null, undefined, true, {}, []]) {
  test(`rejects malformed traffic without silently dropping it: ${String(traffic)}`, () => {
    const invalid = [revisions[0], { ...revisions[1], traffic }];
    assert.throws(() => validate(app, invalid), /production_provenance_traffic_invalid/u);
  });
}

test("rejects duplicate revision names instead of double-counting traffic", () => {
  const row = { ...revisions[0], traffic: 50 };
  assert.throws(() => validate(app, [row, row]), /production_provenance_revision_duplicate/u);
});

for (const row of [null, 42, [], {}, { ...revisions[1], name: " " }]) {
  test(`rejects a malformed revision row: ${JSON.stringify(row)}`, () => {
    assert.throws(
      () => validate(app, [revisions[0], row]),
      /production_provenance_revision_invalid/u,
    );
  });
}

for (const active of ["true", 1, null, undefined]) {
  test(`rejects non-boolean active evidence: ${String(active)}`, () => {
    const invalid = [revisions[0], { ...revisions[1], active }];
    assert.throws(() => validate(app, invalid), /production_provenance_revision_invalid/u);
  });
}

test("accepts multiple active revisions only when all serving images agree", () => {
  const rows = [
    { ...revisions[0], traffic: 60 },
    { ...revisions[1], active: true, traffic: 40, image },
  ];
  assert.equal(validate(app, rows).trafficTotal, 100);
  assert.equal(validate(app, rows).activeRevisionCount, 2);
});

test("retains the latest-ready fallback when latest revision is absent", () => {
  const evidence = { image, latestReadyRevision: app.latestRevision };
  assert.equal(validate(evidence, revisions).latestRevision, app.latestRevision);
});

test("rejects evidence with no active revision", () => {
  const rows = revisions.map((row) => ({ ...row, active: false, traffic: 0 }));
  assert.throws(() => validate(app, rows), /production_provenance_no_active_revision/u);
});

for (const traffic of [-1, 101, 0.5]) {
  test(`rejects out-of-range or fractional traffic: ${traffic}`, () => {
    const rows = [
      { ...revisions[0], traffic },
      { ...revisions[1], traffic: 100 - traffic },
    ];
    assert.throws(() => validate(app, rows), /production_provenance_traffic_invalid/u);
  });
}

for (const value of [[image], null, undefined]) {
  test(`rejects non-string image evidence: ${String(value)}`, () => {
    const invalid = { ...app, image: value };
    assert.throws(() => validate(invalid, revisions), /production_provenance_image_not_immutable/u);
  });
}

for (const value of [null, false, 0, "tag:latest"]) {
  test(`rejects invalid expected-image requirements: ${String(value)}`, () => {
    assert.throws(
      () => validate(app, revisions, value),
      /production_provenance_expected_image_invalid/u,
    );
  });
}

test("does not coerce a latest-revision array to a valid name", () => {
  const invalid = { ...app, latestRevision: [app.latestRevision] };
  assert.throws(
    () => validate(invalid, revisions),
    /production_provenance_latest_revision_missing/u,
  );
});

test("capture keeps audit source distinct and retains failed validation evidence", () => {
  const path = new URL(
    "../../.github/workflows/audit-azure-production-provenance.yml",
    import.meta.url,
  );
  const workflow = readFileSync(path, "utf8");
  assert.match(workflow, /id: capture/u);
  assert.match(workflow, /if: always\(\) && steps\.capture\.outcome == 'success'/u);
  assert.match(workflow, /audit-source-sha\.txt/u);
  assert.match(workflow, /audit-source-tree\.txt/u);
  assert.doesNotMatch(workflow, /\$evidence\/source-(?:sha|tree)\.txt/u);
  const azureCommands = [...workflow.matchAll(/^\s*az ([^\n]+)/gmu)].map((match) =>
    match[1].trim(),
  );
  assert.deepEqual(azureCommands, ["containerapp show \\", "containerapp revision list \\"]);
  assert.match(workflow, /inputs\.confirmation == 'AUDIT' && github\.ref == 'refs\/heads\/main'/u);
});
