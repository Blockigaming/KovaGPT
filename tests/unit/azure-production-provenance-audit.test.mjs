import assert from "node:assert/strict";
import test from "node:test";

import {
  validateProductionProvenanceEvidence,
} from "../../scripts/azure/production-provenance-audit.mjs";

const image = `kovagptacr.azurecr.io/kovagpt@sha256:${"a".repeat(64)}`;
const app = {
  image,
  latestRevision: "kovagpt-prod-web--abc",
};
const revisions = [
  {
    name: "kovagpt-prod-web--abc",
    active: true,
    traffic: 100,
    image,
  },
  {
    name: "kovagpt-prod-web--old",
    active: false,
    traffic: 0,
    image: `kovagptacr.azurecr.io/kovagpt@sha256:${"b".repeat(64)}`,
  },
];

test("accepts one immutable serving production image with 100 percent traffic", () => {
  assert.deepEqual(validateProductionProvenanceEvidence(app, revisions, image), {
    image,
    latestRevision: "kovagpt-prod-web--abc",
    activeRevisionCount: 1,
    servingRevisions: ["kovagpt-prod-web--abc"],
    trafficTotal: 100,
  });
});

test("rejects mutable production image tags", () => {
  assert.throws(
    () =>
      validateProductionProvenanceEvidence(
        { ...app, image: "kovagptacr.azurecr.io/kovagpt:latest" },
        revisions,
      ),
    /production_provenance_image_not_immutable/u,
  );
});

test("rejects a running image that differs from the approved digest", () => {
  assert.throws(
    () =>
      validateProductionProvenanceEvidence(
        app,
        revisions,
        `kovagptacr.azurecr.io/kovagpt@sha256:${"c".repeat(64)}`,
      ),
    /production_provenance_image_mismatch/u,
  );
});

test("rejects incomplete production traffic", () => {
  assert.throws(
    () => validateProductionProvenanceEvidence(app, [{ ...revisions[0], traffic: 90 }]),
    /production_provenance_traffic_total_invalid/u,
  );
});

test("rejects traffic sent to a revision using another image", () => {
  assert.throws(
    () =>
      validateProductionProvenanceEvidence(app, [
        { ...revisions[0], traffic: 50 },
        { ...revisions[1], active: true, traffic: 50 },
      ]),
    /production_provenance_serving_image_mismatch/u,
  );
});

test("rejects evidence where the latest revision receives no traffic", () => {
  assert.throws(
    () =>
      validateProductionProvenanceEvidence(
        { ...app, latestRevision: "kovagpt-prod-web--new" },
        revisions,
      ),
    /production_provenance_latest_revision_not_serving/u,
  );
});
