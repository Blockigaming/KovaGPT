/**
 * KovaGPT source notification coverage audit.
 *
 * The contract has three separate questions:
 *  1. Does this event have an actual code emitter / persisted server source?
 *  2. Is there a backend-capable *conditional* route, such as a release campaign?
 *  3. Has an end-to-end scenario passed? (Never inferred from code presence.)
 *
 * Run: node scripts/audit-notification-coverage.mjs [--require-complete]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTIFICATION_IDS, NOTIFICATION_GROUPS } from "../src/lib/notification-catalog.mjs";
import { verifiedEndToEndIds } from "../src/lib/notification-acceptance-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const reportArgument = process.argv.find((argument) =>
  argument.startsWith("--playwright-report="),
);
const requiredEvidenceArgument = process.argv.find((argument) =>
  argument.startsWith("--require-verified="),
);
const requiredEvidenceIds = requiredEvidenceArgument
  ? requiredEvidenceArgument
      .slice("--require-verified=".length)
      .split(",")
      .filter(Boolean)
  : [];
let evidenceError = null;
let verified = new Set();
if (reportArgument) {
  try {
    const reportPath = resolve(root, reportArgument.slice("--playwright-report=".length));
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    verified = verifiedEndToEndIds(report, NOTIFICATION_IDS);
  } catch (error) {
    evidenceError = error instanceof Error ? error.message : String(error);
  }
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(tsx|ts|mjs|jsx|js)$/.test(entry.name) ? [path] : [];
  });
}
const origins = walk(join(root, "src")).filter(
  (path) =>
    !path.endsWith("notification-catalog.mjs") &&
    !path.endsWith("KovaNotificationSurface.tsx") &&
    !path.endsWith("announcement-campaign-policy.mjs"),
);
const index = new Map(
  NOTIFICATION_IDS.map((id) => [
    id,
    { literal: new Set(), conditional: new Set(), persisted: new Set() },
  ]),
);
const unknownDynamicEmitters = [];
for (const path of origins) {
  const code = readFileSync(path, "utf8");
  const rel = relative(root, path);
  // Capture the ID expression up to the first object field delimiter.
  // Conditional expressions may contain multiple valid catalog IDs.
  const emits = /publishKovaNotice\s*\(\s*\{[\s\S]{0,220}?\bid\s*:\s*([^,}\n]+(?:\n[^,}]+){0,5})/g;
  for (const match of code.matchAll(emits)) {
    const expression = match[1].trim();
    const choices = [...expression.matchAll(/["']([a-z0-9_]+)["']/g)]
      .map((m) => m[1])
      .filter((id) => index.has(id));
    if (!choices.length) {
      unknownDynamicEmitters.push({ path: rel, expression: expression.slice(0, 100) });
      continue;
    }
    const direct = /^["']([a-z0-9_]+)["']\s*$/.exec(expression);
    for (const id of choices) index.get(id)[direct ? "literal" : "conditional"].add(rel);
  }
}
// The durable inbox has server-created notification types distinct from the
// client event IDs. Count only explicit, reviewable mappings.
const mapFile = join(root, "src/lib/persisted-notification-policy.mjs");
const mapping = readFileSync(mapFile, "utf8");
const mapSection = mapping.match(/const SERVER_KIND_TO_NOTICE\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? "";
for (const match of mapSection.matchAll(/^\s*[a-z_]+\s*:\s*["']([a-z_]+)["']/gm)) {
  if (index.has(match[1]))
    index.get(match[1]).persisted.add("src/lib/persisted-notification-policy.mjs");
}
const campaignCapable = readFileSync(
  join(root, "src/components/AnnouncementCampaignBridge.tsx"),
  "utf8",
).includes("listEligibleAnnouncementCampaigns");
const rows = NOTIFICATION_IDS.map((id) => {
  const sources = index.get(id);
  const literalEmitters = [...sources.literal];
  const conditionalEmitters = [...sources.conditional];
  const persistedEmitters = [...sources.persisted];
  const group = Object.entries(NOTIFICATION_GROUPS).find(([, items]) => items.includes(id))?.[0];
  const sourceConnected =
    literalEmitters.length > 0 || conditionalEmitters.length > 0 || persistedEmitters.length > 0;
  return {
    id,
    group,
    literalEmitters,
    conditionalEmitters,
    persistedEmitters,
    sourceConnected,
    campaignCapable: group === "announcements" && campaignCapable,
    // Only actual browser+backend test results may mark this true.
    verifiedEndToEnd: verified.has(id),
  };
});
const summary = {
  total: rows.length,
  literalEmitted: rows.filter((row) => row.literalEmitters.length).length,
  conditionalEmitted: rows.filter((row) => row.conditionalEmitters.length).length,
  persistedMapped: rows.filter((row) => row.persistedEmitters.length).length,
  sourceConnected: rows.filter((row) => row.sourceConnected).length,
  campaignCapable: rows.filter((row) => row.campaignCapable).length,
  missingSourceEmitter: rows.filter((row) => !row.sourceConnected).length,
  unclassifiedDynamicEmitters: unknownDynamicEmitters.length,
  verifiedEndToEnd: rows.filter((row) => row.verifiedEndToEnd).length,
  missingEndToEndEvidence: rows.filter((row) => !row.verifiedEndToEnd).length,
  requiredVerified: requiredEvidenceIds.length,
  missingRequiredVerified: requiredEvidenceIds.filter(
    (id) => !NOTIFICATION_IDS.includes(id) || !verified.has(id),
  ),
};
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify({ summary, rows, unknownDynamicEmitters, evidenceError }, null, 2) + "\n");
  if (
    requiredEvidenceArgument &&
    (!reportArgument ||
      evidenceError ||
      requiredEvidenceIds.some((id) => !NOTIFICATION_IDS.includes(id) || !verified.has(id)))
  )
    process.exitCode = 1;
  if (
    process.argv.includes("--require-complete") &&
    (summary.missingSourceEmitter > 0 ||
      summary.unclassifiedDynamicEmitters > 0 ||
      summary.missingEndToEndEvidence > 0 ||
      evidenceError)
  )
    process.exitCode = 1;
}
export { rows, summary, unknownDynamicEmitters };
