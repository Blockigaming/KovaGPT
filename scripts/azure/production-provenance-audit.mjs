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

  const image = String(app.image ?? "");
  if (!DIGEST_IMAGE.test(image)) throw new Error("production_provenance_image_not_immutable");
  if (expectedImage && image !== expectedImage) {
    throw new Error("production_provenance_image_mismatch");
  }

  const latestRevision = String(app.latestRevision ?? app.latestReadyRevision ?? "");
  if (!latestRevision) throw new Error("production_provenance_latest_revision_missing");

  const active = revisions.filter((revision) => revision?.active === true);
  if (!active.length) throw new Error("production_provenance_no_active_revision");

  const traffic = revisions
    .map((revision) => Number(revision?.traffic ?? 0))
    .filter((value) => Number.isFinite(value));
  if (traffic.some((value) => value < 0 || value > 100)) {
    throw new Error("production_provenance_traffic_invalid");
  }
  const trafficTotal = traffic.reduce((sum, value) => sum + value, 0);
  if (trafficTotal !== 100) throw new Error("production_provenance_traffic_total_invalid");

  const serving = revisions.filter((revision) => Number(revision?.traffic ?? 0) > 0);
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
