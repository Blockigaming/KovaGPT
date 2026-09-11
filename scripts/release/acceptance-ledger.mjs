import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format as formatWithPrettier } from "prettier";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_PATH = resolve(ROOT, "docs/release/acceptance-ledger.md");
const OUTPUT_PATH = resolve(ROOT, "docs/release/acceptance-ledger.generated.json");
const CAPABILITY_AUDIT_PATH = resolve(ROOT, "docs/product-parity/capability-audit.json");
const LEGACY_TEST_INVENTORY_PATH = resolve(ROOT, "docs/release-reconciliation/test-inventory.json");

const EXPECTED_AREA_IDS = Array.from({ length: 27 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);
const STAGES = ["source", "local_automation", "hosted_ci", "staging", "production"];
const EXACT_HEAD_EVIDENCE = {
  pullRequest: 318,
  pullRequestHead: "6869d6c122180a290f39f59d8ae88be39fd9f252",
  workflows: [
    { id: 34491377736, name: "KovaGPT CI", conclusion: "success" },
    { id: 34491377765, name: "Work Sandbox Isolation", conclusion: "success" },
    { id: 34491377790, name: "Azure Container Readiness", conclusion: "success" },
  ],
};

function parseJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    else files.push(relative(ROOT, entryPath).replaceAll("\\\\", "/"));
  }
  return files;
}

function parseLedger(markdown) {
  const identity = markdown.match(
    /Reconciled \*\*(\d{4}-\d{2}-\d{2})\*\* against integrated `main` commit\s+`([0-9a-f]{40})`\./s,
  );
  if (!identity) throw new Error("Acceptance ledger is missing its exact main commit identity.");

  const progress = markdown.match(/provisional \*\*(\d+(?:\.\d+)?)%\*\*/);
  if (!progress) throw new Error("Acceptance ledger is missing its provisional progress value.");

  const areas = markdown
    .split("\n")
    .filter((line) => /^\| \d{2}\s+\|/.test(line))
    .map((line) => {
      const [id, area, classification, implementedEvidence, boundary] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { id, area, classification, implementedEvidence, boundary };
    });

  return {
    reconciledAt: identity[1],
    auditedMainCommit: identity[2],
    provisionalOverallProgress: Number(progress[1]),
    areas,
  };
}

function sourceStatus(classification) {
  if (classification.startsWith("Implemented")) return "accepted";
  if (classification.startsWith("Partial")) return "partial";
  if (classification.startsWith("Excluded")) return "excluded";
  throw new Error(`Unsupported acceptance classification: ${classification}`);
}

function areaStages(area, capability) {
  const currentSourceStatus = sourceStatus(area.classification);
  return [
    {
      id: `${area.id}.source`,
      stage: "source",
      status: currentSourceStatus,
      requirement: area.implementedEvidence,
      evidence: capability.sourceEvidence,
      boundary: area.boundary,
    },
    {
      id: `${area.id}.local`,
      stage: "local_automation",
      status: "verified_for_implemented_scope",
      requirement: "Referenced automated coverage exists and the exact-head gate suite passed.",
      evidence: capability.testEvidence,
      boundary:
        currentSourceStatus === "partial"
          ? "Passing tests verify the implemented slice, not the missing source requirement."
          : "Passing tests do not prove live provider, account, device, or production behavior.",
    },
    {
      id: `${area.id}.hosted`,
      stage: "hosted_ci",
      status: "verified_for_implemented_scope",
      requirement:
        "The reviewed exact PR head passed the hosted source, browser, and container gates.",
      evidence: [
        `github:pull/${EXACT_HEAD_EVIDENCE.pullRequest}@${EXACT_HEAD_EVIDENCE.pullRequestHead}`,
        ...EXACT_HEAD_EVIDENCE.workflows.map(
          (workflow) => `github:actions/${workflow.id}:${workflow.name}:${workflow.conclusion}`,
        ),
      ],
      boundary:
        currentSourceStatus === "partial"
          ? "Hosted gates verify the implemented slice, not the missing source requirement."
          : "Hosted CI is pre-deployment evidence and does not certify a live environment.",
    },
    {
      id: `${area.id}.staging`,
      stage: "staging",
      status: "not_verified",
      requirement: "Exercise the bounded behavior against matching staged services and accounts.",
      evidence: [],
      boundary: area.boundary,
    },
    {
      id: `${area.id}.production`,
      stage: "production",
      status: "not_verified",
      requirement:
        "Verify the exact deployed SHA and image with production smoke and canary evidence.",
      evidence: [],
      boundary: area.boundary,
    },
  ].map((stage) => ({ areaId: area.id, area: area.area, ...stage }));
}

export function buildAcceptanceLedger() {
  const markdown = readFileSync(LEDGER_PATH, "utf8");
  const parsed = parseLedger(markdown);
  const capabilityAudit = parseJson(CAPABILITY_AUDIT_PATH);
  const legacyTestInventory = parseJson(LEGACY_TEST_INVENTORY_PATH);

  const actualIds = parsed.areas.map((area) => area.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(EXPECTED_AREA_IDS)) {
    throw new Error(
      `Acceptance ledger area IDs are incomplete or unordered: ${actualIds.join(", ")}`,
    );
  }

  const capabilities = new Map(capabilityAudit.surfaces.map((surface) => [surface.id, surface]));
  const missingCapabilities = EXPECTED_AREA_IDS.filter((id) => !capabilities.has(id));
  if (missingCapabilities.length) {
    throw new Error(`Capability audit is missing areas: ${missingCapabilities.join(", ")}`);
  }

  const evidencePaths = [
    ...new Set(
      capabilityAudit.surfaces.flatMap((surface) => [
        ...surface.sourceEvidence,
        ...surface.testEvidence,
      ]),
    ),
  ].sort();
  const missingEvidencePaths = evidencePaths.filter((path) => !existsSync(resolve(ROOT, path)));
  if (missingEvidencePaths.length) {
    throw new Error(`Acceptance evidence paths are missing: ${missingEvidencePaths.join(", ")}`);
  }

  const legacyTestPaths = legacyTestInventory.records.map((record) => record.file).sort();
  const missingLegacyTests = legacyTestPaths.filter((path) => !existsSync(resolve(ROOT, path)));
  if (missingLegacyTests.length) {
    throw new Error(`Retained legacy tests are missing: ${missingLegacyTests.join(", ")}`);
  }

  const currentTestFiles = listFiles(resolve(ROOT, "tests"))
    .filter((path) => /(?:\.test\.mjs|\.spec\.ts)$/.test(path))
    .sort();
  const currentTestDigest = createHash("sha256").update(currentTestFiles.join("\n")).digest("hex");
  const rows = parsed.areas.flatMap((area) => areaStages(area, capabilities.get(area.id)));

  if (rows.length !== EXPECTED_AREA_IDS.length * STAGES.length) {
    throw new Error(`Expected 135 acceptance rows, found ${rows.length}.`);
  }
  const rowIds = new Set(rows.map((row) => row.id));
  if (rowIds.size !== rows.length) throw new Error("Acceptance row IDs must be unique.");
  for (const area of parsed.areas) {
    const areaStageNames = rows.filter((row) => row.areaId === area.id).map((row) => row.stage);
    if (JSON.stringify(areaStageNames) !== JSON.stringify(STAGES)) {
      throw new Error(`Area ${area.id} does not contain the complete evidence-stage sequence.`);
    }
  }

  const statusCounts = rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    generatedFrom: [
      relative(ROOT, LEDGER_PATH),
      relative(ROOT, CAPABILITY_AUDIT_PATH),
      relative(ROOT, LEGACY_TEST_INVENTORY_PATH),
    ],
    reconciledAt: parsed.reconciledAt,
    auditedMainCommit: parsed.auditedMainCommit,
    provisionalOverallProgress: parsed.provisionalOverallProgress,
    progressRecalculated: false,
    exactHeadEvidence: EXACT_HEAD_EVIDENCE,
    verification: {
      masterAreas: parsed.areas.length,
      stagesPerArea: STAGES.length,
      acceptanceRows: rows.length,
      uniqueAcceptanceRows: rowIds.size,
      evidencePaths: evidencePaths.length,
      missingEvidencePaths: missingEvidencePaths.length,
      retainedLegacyTests: legacyTestPaths.length,
      missingRetainedLegacyTests: missingLegacyTests.length,
      currentTestFiles: currentTestFiles.length,
      currentTestInventorySha256: currentTestDigest,
      statusCounts,
    },
    rows,
  };
}

export function serializeAcceptanceLedger(ledger = buildAcceptanceLedger()) {
  return formatWithPrettier(JSON.stringify(ledger), { parser: "json", printWidth: 100 });
}

async function main() {
  const mode = process.argv[2] ?? "--check";
  const serialized = await serializeAcceptanceLedger();
  if (mode === "--write") {
    writeFileSync(OUTPUT_PATH, serialized, "utf8");
    console.log(`Wrote ${relative(ROOT, OUTPUT_PATH)}.`);
    return;
  }
  if (mode !== "--check") throw new Error(`Unsupported mode: ${mode}`);
  if (!existsSync(OUTPUT_PATH)) throw new Error("Generated acceptance ledger is missing.");
  if (readFileSync(OUTPUT_PATH, "utf8") !== serialized) {
    throw new Error(
      "Generated acceptance ledger is stale. Run with --write and commit the result.",
    );
  }
  const ledger = JSON.parse(serialized);
  console.log(
    `Verified ${ledger.verification.acceptanceRows} acceptance rows across ${ledger.verification.masterAreas} product areas.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
