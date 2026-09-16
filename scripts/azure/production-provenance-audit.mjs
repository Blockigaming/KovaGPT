import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIGEST_IMAGE =
  /^([a-z0-9][a-z0-9.-]*\.azurecr\.io)\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u;

export function validateProductionProvenanceEvidence(app, revisions, expectedImage = "") {
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    throw new Error("production_provenance_app_invalid");
  }
  if (!Array.isArray(revisions) || revisions.length === 0) {
    throw new Error("production_provenance_revisions_invalid");
  }

  const image = app.image;
  if (typeof image !== "string" || !DIGEST_IMAGE.test(image)) {
    throw new Error("production_provenance_image_not_immutable");
  }
  if (typeof expectedImage !== "string" || (expectedImage && !DIGEST_IMAGE.test(expectedImage))) {
    throw new Error("production_provenance_expected_image_invalid");
  }
  if (expectedImage && image !== expectedImage) {
    throw new Error("production_provenance_image_mismatch");
  }

  const latestRevision = app.latestRevision ?? app.latestReadyRevision;
  if (
    typeof latestRevision !== "string" ||
    !latestRevision.trim() ||
    latestRevision !== latestRevision.trim()
  ) {
    throw new Error("production_provenance_latest_revision_missing");
  }

  const names = new Set();
  for (const revision of revisions) {
    if (
      !revision ||
      typeof revision !== "object" ||
      Array.isArray(revision) ||
      typeof revision.name !== "string" ||
      !revision.name.trim() ||
      revision.name !== revision.name.trim() ||
      typeof revision.active !== "boolean"
    ) {
      throw new Error("production_provenance_revision_invalid");
    }
    if (names.has(revision.name)) {
      throw new Error("production_provenance_revision_duplicate");
    }
    names.add(revision.name);
    if (!Number.isInteger(revision.traffic) || revision.traffic < 0 || revision.traffic > 100) {
      throw new Error("production_provenance_traffic_invalid");
    }
    if (revision.traffic > 0 && !revision.active) {
      throw new Error("production_provenance_serving_revision_inactive");
    }
  }

  const active = revisions.filter((revision) => revision.active);
  if (!active.length) throw new Error("production_provenance_no_active_revision");

  const trafficTotal = revisions.reduce((sum, revision) => sum + revision.traffic, 0);
  if (trafficTotal !== 100) throw new Error("production_provenance_traffic_total_invalid");

  const serving = revisions.filter((revision) => revision.traffic > 0);
  if (serving.some((revision) => revision.image !== image)) {
    throw new Error("production_provenance_serving_image_mismatch");
  }
  if (!serving.some((revision) => revision.name === latestRevision)) {
    throw new Error("production_provenance_latest_revision_not_serving");
  }

  return {
    image,
    latestRevision,
    activeRevisionCount: active.length,
    servingRevisions: serving.map((revision) => revision.name).sort(),
    trafficTotal,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const appPath = resolve(process.env.KOVA_AZURE_PRODUCTION_APP_EVIDENCE ?? "");
  const revisionsPath = resolve(process.env.KOVA_AZURE_PRODUCTION_REVISION_EVIDENCE ?? "");
  if (
    !process.env.KOVA_AZURE_PRODUCTION_APP_EVIDENCE ||
    !process.env.KOVA_AZURE_PRODUCTION_REVISION_EVIDENCE
  ) {
    throw new Error("production_provenance_evidence_paths_required");
  }
  const app = JSON.parse(readFileSync(appPath, "utf8"));
  const revisions = JSON.parse(readFileSync(revisionsPath, "utf8"));
  const report = validateProductionProvenanceEvidence(
    app,
    revisions,
    process.env.KOVA_EXPECTED_PRODUCTION_IMAGE ?? "",
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
