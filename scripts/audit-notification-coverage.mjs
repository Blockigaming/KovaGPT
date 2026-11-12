/**
 * KovaGPT source notification coverage audit.
 *
 * The contract has three separate questions:
 *  1. Does this event have an actual code emitter, application-owned UI, or inbox mapping?
 *  2. Is there a backend-capable *conditional* route, such as a release campaign?
 *  3. Has an end-to-end scenario passed? (Never inferred from code presence.)
 *
 * Run: node scripts/audit-notification-coverage.mjs [--require-complete]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { NOTIFICATION_IDS, NOTIFICATION_GROUPS } from "../src/lib/notification-catalog.mjs";
import { verifiedEndToEndIds } from "../src/lib/notification-acceptance-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const reportArg = process.argv.find((arg) => arg.startsWith("--playwright-report="));
const requiredArg = process.argv.find((arg) => arg.startsWith("--require-verified="));
const requiredEvidenceIds = requiredArg
  ? requiredArg.slice("--require-verified=".length).split(",").filter(Boolean)
  : [];
let evidenceError = null;
let verified = new Set();
if (reportArg) {
  try {
    const reportPath = resolve(root, reportArg.slice("--playwright-report=".length));
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
    { literal: new Set(), conditional: new Set(), native: new Set(), persisted: new Set() },
  ]),
);
const unknownDynamicEmitters = [];
const chatPolicy = "src/lib/chat-notice-policy.mjs";

function parseSource(path) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

function staticIds(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node))
    return [...staticIds(node.whenTrue), ...staticIds(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return staticIds(node.expression);
  return [];
}

const chatFailureIds = new Set();
visit(parseSource(join(root, chatPolicy)), (node) => {
  if (ts.isReturnStatement(node)) {
    for (const id of staticIds(node.expression)) chatFailureIds.add(id);
  }
});

function localInitializer(identifier, statement) {
  for (let scope = statement.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope)) continue;
    const declarations = scope.statements
      .filter((item) => item.end < statement.getStart() && ts.isVariableStatement(item))
      .flatMap((item) => [...item.declarationList.declarations]);
    const match = declarations.findLast(
      (item) => ts.isIdentifier(item.name) && item.name.text === identifier,
    );
    if (match) return match.initializer;
  }
  return undefined;
}

function record(ids, kind, path) {
  for (const id of ids) {
    const row = index.get(id);
    if (row) row[kind].add(path);
    else unknownDynamicEmitters.push({ path, expression: id });
  }
}

for (const path of origins) {
  const file = parseSource(path);
  const rel = relative(root, path);
  visit(file, (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      const tag = node.parent.parent.tagName.getText(file);
      if (
        name !== "data-kova-notice-id" &&
        !(name === "noticeId" && (tag === "ConfirmActionDialog" || tag === "ConfirmDialog"))
      )
        return;
      const value = node.initializer;
      record(
        staticIds(value && ts.isJsxExpression(value) ? value.expression : value),
        "native",
        rel,
      );
      return;
    }
    if (!ts.isCallExpression(node) || node.expression.getText(file) !== "publishKovaNotice") return;
    const payload = node.arguments[0];
    const field =
      payload &&
      ts.isObjectLiteralExpression(payload) &&
      payload.properties.find(
        (item) => ts.isPropertyAssignment(item) && item.name.getText(file) === "id",
      );
    if (!field) {
      unknownDynamicEmitters.push({ path: rel, expression: "Missing a static notice payload" });
      return;
    }
    const value = field.initializer;
    const expression = value.getText(file);
    if (
      (rel === "src/components/AnnouncementCampaignBridge.tsx" &&
        expression === "campaign.eventId") ||
      (rel === "src/components/PersistedNoticeBridge.tsx" && expression === "type")
    )
      return;
    let ids = staticIds(value);
    if (ts.isIdentifier(value)) {
      const initializer = localInitializer(value.text, node);
      if (
        rel === "src/routes/index.tsx" &&
        initializer &&
        ts.isCallExpression(initializer) &&
        initializer.expression.getText(file) === "chatFailureNoticeId"
      )
        ids = [...chatFailureIds];
      else ids = staticIds(initializer);
    }
    if (!ids.length) {
      unknownDynamicEmitters.push({ path: rel, expression: expression.slice(0, 100) });
      return;
    }
    record(ids, ts.isStringLiteralLike(value) ? "literal" : "conditional", rel);
  });
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
  const nativeSurfaces = [...sources.native];
  const persistedEmitters = [...sources.persisted];
  const group = Object.entries(NOTIFICATION_GROUPS).find(([, items]) => items.includes(id))?.[0];
  const sourceConnected =
    literalEmitters.length > 0 ||
    conditionalEmitters.length > 0 ||
    nativeSurfaces.length > 0 ||
    persistedEmitters.length > 0;
  return {
    id,
    group,
    literalEmitters,
    conditionalEmitters,
    nativeSurfaces,
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
  nativeSurfaces: rows.filter((row) => row.nativeSurfaces.length).length,
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
  process.stdout.write(
    JSON.stringify({ summary, rows, unknownDynamicEmitters, evidenceError }, null, 2) + "\n",
  );
  if (
    requiredArg &&
    (!reportArg ||
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
