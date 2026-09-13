import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format as formatWithPrettier } from "prettier";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_PATH = resolve(ROOT, "docs/release/acceptance-ledger.md");
const OUTPUT_PATH = resolve(ROOT, "docs/release/acceptance-ledger.generated.json");
const FINAL_GOAL_PATH = resolve(ROOT, "docs/release/kova-final-goal-2026-09-11.md");
const FINAL_GOAL_CONTRACT_PATH = resolve(ROOT, "docs/release/final-goal-contract.json");
const CAPABILITY_AUDIT_PATH = resolve(ROOT, "docs/product-parity/capability-audit.json");
const LEGACY_TEST_INVENTORY_PATH = resolve(ROOT, "docs/release-reconciliation/test-inventory.json");

const EXPECTED_AREA_IDS = Array.from({ length: 27 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);
const STAGES = ["source", "local_automation", "hosted_ci", "staging", "production"];
const REVIEWED_IMPLEMENTATION_BASELINE = {
  pullRequest: 319,
  pullRequestHead: "20940476881dadabfcedbfeadb4aba328dd8cd52",
  workflows: [
    { id: 34664358655, name: "KovaGPT CI", conclusion: "success" },
    {
      id: 34664358673,
      name: "Azure Container Readiness",
      conclusion: "success",
    },
  ],
};
const FINAL_GOAL_REQUIREMENT_IDS = [
  ...Array.from({ length: 18 }, (_, index) => `FG-${String(index + 1).padStart(2, "0")}`),
  "FG-X1",
  "FG-X2",
  "FG-X3",
];
const FINAL_GOAL_STATUSES = new Set(["source_partial", "specified_unimplemented", "not_verified"]);

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
    /Reconciled \*\*(\d{4}-\d{2}-\d{2})\*\* against reviewed PR #(\d+) ancestor implementation head\s+`([0-9a-f]{40})`, based on `main` commit `([0-9a-f]{40})`\./s,
  );
  if (!identity) {
    throw new Error("Acceptance ledger is missing its reviewed candidate and main identities.");
  }

  const progress = markdown.match(/owner-declared \*\*(\d+(?:\.\d+)?)%\*\*/);
  if (!progress) {
    throw new Error("Acceptance ledger is missing its owner-declared progress checkpoint.");
  }

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
    reviewedPullRequest: Number(identity[2]),
    reviewedCandidateHead: identity[3],
    auditedMainCommit: identity[4],
    ownerDeclaredOverallProgress: Number(progress[1]),
    areas,
  };
}

function validateFinalGoalContract(contract) {
  if (contract.owner !== "Zachary") throw new Error("Final-goal contract owner must be Zachary.");
  if (contract.source !== relative(ROOT, FINAL_GOAL_PATH)) {
    throw new Error("Final-goal contract must reference the durable September 11 goal.");
  }
  if (
    contract.overallProgress?.value !== 76.5 ||
    contract.overallProgress?.kind !== "owner_declared_checkpoint" ||
    contract.overallProgress?.recalculated !== false
  ) {
    throw new Error("Final-goal contract changed the owner-declared overall checkpoint.");
  }
  if (
    contract.uiCompletion?.value !== 1 ||
    contract.uiCompletion?.kind !== "separate_owner_quality_assessment" ||
    contract.uiCompletion?.recalculated !== false
  ) {
    throw new Error("Final-goal contract changed the separate owner UI assessment.");
  }
  if (contract.voiceRequired !== true) {
    throw new Error("Final-goal contract must retain voice as required scope.");
  }

  const requirements = Array.isArray(contract.requirements) ? contract.requirements : [];
  const ids = requirements.map((requirement) => requirement.id);
  if (JSON.stringify(ids) !== JSON.stringify(FINAL_GOAL_REQUIREMENT_IDS)) {
    throw new Error(`Final-goal requirement IDs are incomplete or unordered: ${ids.join(", ")}`);
  }
  for (const requirement of requirements) {
    if (
      requirement.owner !== contract.owner ||
      requirement.source !== contract.source ||
      !requirement.title ||
      !requirement.sourceSection ||
      !requirement.acceptanceTest ||
      !requirement.boundary ||
      !Array.isArray(requirement.dependencies) ||
      requirement.dependencies.length === 0 ||
      !Array.isArray(requirement.mappedAreaIds) ||
      requirement.mappedAreaIds.length === 0 ||
      !Array.isArray(requirement.evidence) ||
      !FINAL_GOAL_STATUSES.has(requirement.status)
    ) {
      throw new Error(`Final-goal requirement ${requirement.id} is missing required metadata.`);
    }
    const invalidAreas = requirement.mappedAreaIds.filter((id) => !EXPECTED_AREA_IDS.includes(id));
    if (invalidAreas.length) {
      throw new Error(
        `Final-goal requirement ${requirement.id} maps unknown areas: ${invalidAreas.join(", ")}`,
      );
    }
    if (requirement.status === "source_partial" && requirement.evidence.length === 0) {
      throw new Error(`Partial final-goal requirement ${requirement.id} needs source evidence.`);
    }
  }
  return requirements;
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
      requirement: "Referenced automated coverage exists and is exercised by the release gate.",
      evidence: capability.testEvidence,
      boundary:
        currentSourceStatus === "partial"
          ? "Passing tests verify the implemented slice, not the missing source requirement."
          : "Passing tests do not prove live provider, account, device, or production behavior.",
    },
    {
      id: `${area.id}.hosted`,
      stage: "hosted_ci",
      status: "verified_for_reviewed_ancestor_scope",
      requirement:
        "A reviewed ancestor implementation head passed the hosted source, browser, and container gates.",
      evidence: [
        `github:pull/${REVIEWED_IMPLEMENTATION_BASELINE.pullRequest}@${REVIEWED_IMPLEMENTATION_BASELINE.pullRequestHead}`,
        ...REVIEWED_IMPLEMENTATION_BASELINE.workflows.map(
          (workflow) => `github:actions/${workflow.id}:${workflow.name}:${workflow.conclusion}`,
        ),
      ],
      boundary:
        currentSourceStatus === "partial"
          ? "Ancestor hosted gates verify only that implementation slice, not this revision or the missing source requirement."
          : "Ancestor hosted CI does not verify this revision or certify a live environment.",
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
  const finalGoalContract = parseJson(FINAL_GOAL_CONTRACT_PATH);
  const finalGoalRequirements = validateFinalGoalContract(finalGoalContract);
  const capabilityAudit = parseJson(CAPABILITY_AUDIT_PATH);
  const legacyTestInventory = parseJson(LEGACY_TEST_INVENTORY_PATH);

  if (
    parsed.reviewedPullRequest !== REVIEWED_IMPLEMENTATION_BASELINE.pullRequest ||
    parsed.reviewedCandidateHead !== REVIEWED_IMPLEMENTATION_BASELINE.pullRequestHead
  ) {
    throw new Error(
      "Acceptance ledger identity does not match its reviewed implementation baseline.",
    );
  }
  if (
    capabilityAudit.sourceCommit !== parsed.reviewedCandidateHead ||
    capabilityAudit.ownerDeclaredOverallProgress !== parsed.ownerDeclaredOverallProgress ||
    capabilityAudit.uiCompletion !== finalGoalContract.uiCompletion.value ||
    capabilityAudit.voiceAudioDictation !== "required_unavailable" ||
    capabilityAudit.scopeContract !== relative(ROOT, FINAL_GOAL_CONTRACT_PATH)
  ) {
    throw new Error("Capability audit is stale against the reviewed final-goal contract.");
  }

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
  for (const area of parsed.areas) {
    const expectedStatus =
      sourceStatus(area.classification) === "accepted" ? "bounded_source" : "partial_source";
    const capability = capabilities.get(area.id);
    if (
      capability.sourceStatus !== expectedStatus ||
      capability.localStatus !== "verified_for_implemented_scope_at_reviewed_candidate" ||
      capability.hostedStatus !== "verified_for_reviewed_ancestor_scope" ||
      capability.stagingStatus !== "not_exercised" ||
      capability.productionStatus !== "not_verified"
    ) {
      throw new Error(`Capability audit area ${area.id} has stale evidence-stage metadata.`);
    }
  }

  const evidencePaths = [
    ...new Set([
      ...capabilityAudit.surfaces.flatMap((surface) => [
        ...surface.sourceEvidence,
        ...surface.testEvidence,
      ]),
      ...finalGoalRequirements.flatMap((requirement) => requirement.evidence),
    ]),
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
  const rows = parsed.areas
    .flatMap((area) => areaStages(area, capabilities.get(area.id)))
    .map((row) => ({
      ...row,
      finalGoalRequirementIds: finalGoalRequirements
        .filter((requirement) => requirement.mappedAreaIds.includes(row.areaId))
        .map((requirement) => requirement.id),
    }));

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
  const finalGoalStatusCounts = finalGoalRequirements.reduce((counts, requirement) => {
    counts[requirement.status] = (counts[requirement.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 2,
    generatedFrom: [
      relative(ROOT, LEDGER_PATH),
      relative(ROOT, FINAL_GOAL_PATH),
      relative(ROOT, FINAL_GOAL_CONTRACT_PATH),
      relative(ROOT, CAPABILITY_AUDIT_PATH),
      relative(ROOT, LEGACY_TEST_INVENTORY_PATH),
    ],
    reconciledAt: parsed.reconciledAt,
    auditedMainCommit: parsed.auditedMainCommit,
    reviewedImplementationBaseline: {
      pullRequest: parsed.reviewedPullRequest,
      head: parsed.reviewedCandidateHead,
    },
    ownerDeclaredOverallProgress: parsed.ownerDeclaredOverallProgress,
    progressKind: "owner_declared_checkpoint",
    progressRecalculated: false,
    uiCompletion: finalGoalContract.uiCompletion,
    finalGoal: {
      source: finalGoalContract.source,
      owner: finalGoalContract.owner,
      scopeUpdated: finalGoalContract.scopeUpdated,
      voiceRequired: finalGoalContract.voiceRequired,
      requirements: finalGoalRequirements,
    },
    reviewedImplementationEvidence: REVIEWED_IMPLEMENTATION_BASELINE,
    verification: {
      masterAreas: parsed.areas.length,
      stagesPerArea: STAGES.length,
      acceptanceRows: rows.length,
      uniqueAcceptanceRows: rowIds.size,
      finalGoalRequirements: finalGoalRequirements.length,
      finalGoalStatusCounts,
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
  return formatWithPrettier(JSON.stringify(ledger), {
    parser: "json",
    printWidth: 100,
  });
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
