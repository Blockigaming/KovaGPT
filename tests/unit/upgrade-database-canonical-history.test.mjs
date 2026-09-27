import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assessCanonicalScheduledRecurrence,
  extendProposedCanonicalHistory,
  HISTORY_ONLY_SENTINEL,
} from "../../scripts/release/upgrade-database-canonical-history.mjs";
import {
  extendCurrentHistory,
  CURRENT_HISTORY_SNAPSHOT,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import { planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";
import {
  SCHEDULED_CATALOG_QUERY_SHA256,
  SCHEDULED_CATALOG_SQL,
} from "../../scripts/release/upgrade-database-scheduled-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPAIRED = ["20260822122000", "20260823113000", "20260903145843"];
const inspectSource = () => ({
  commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  trackedFileCount: 1,
  readFile: readFileSync,
  readDirectory: readdirSync,
});

test("canonical history rehearsal pins exactly 108 bodies and 3 equivalent history records", () => {
  const dry = rehearseUpgrade({ canonicalHistory: true, currentHistory: true, dryRun: true });
  assert.equal(dry.baselineVersions, 98);
  assert.equal(dry.pendingVersions.length, 111);
  assert.equal(dry.replayPendingVersions.length, 108);
  const extensionVersions = JSON.parse(readFileSync(join(ROOT, "release-migrations.json")))
    .migrations.slice(157)
    .map((entry) => entry.timestamp);
  assert.equal(extensionVersions.length, 28);
  assert.deepEqual(dry.canonicalHistoryProposal.deferredExtensionVersions, []);
  assert.ok(extensionVersions.every((version) => dry.replayPendingVersions.includes(version)));
  assert.deepEqual(dry.canonicalHistoryProposal.recordOnlyVersions, REPAIRED);
  assert.equal(dry.canonicalHistoryProposal.expectedFinalLedgerCount, 209);
  assert.equal(dry.canonicalHistoryProposal.productionReleaseReady, false);
  assert.equal(dry.executed, false);
  assert.throws(
    () => rehearseUpgrade({ canonicalHistory: true, dryRun: true }),
    /upgrade_canonical_history_current_history_required/u,
  );
});

test("canonical history proposal rejects a changed body before local commands", () => {
  const plan = extendCurrentHistory(
    planUpgrade(),
    readFileSync(join(ROOT, CURRENT_HISTORY_SNAPSHOT)),
  );
  plan.forward.find((row) => row.version === REPAIRED[0]).sha256 = "0".repeat(64);
  assert.throws(
    () => extendProposedCanonicalHistory(plan),
    /upgrade_canonical_history_source_mismatch/u,
  );
});

test("canonical history proposal rejects a changed current migration", () => {
  const plan = extendCurrentHistory(
    planUpgrade(),
    readFileSync(join(ROOT, CURRENT_HISTORY_SNAPSHOT)),
  );
  plan.forward.find((row) => row.version === "20260925000821").sha256 = "0".repeat(64);
  assert.throws(
    () => extendProposedCanonicalHistory(plan),
    /upgrade_canonical_history_source_mismatch/u,
  );
});

test("canonical rehearsal reads the decision and all manifests through its captured reader", () => {
  const plan = extendCurrentHistory(
    planUpgrade(),
    readFileSync(join(ROOT, CURRENT_HISTORY_SNAPSHOT)),
  );
  const files = new Set();
  const directories = new Set();
  const result = extendProposedCanonicalHistory(
    plan,
    ROOT,
    (filename) => {
      files.add(filename);
      return readFileSync(filename);
    },
    (directory) => {
      directories.add(directory);
      return readdirSync(directory);
    },
  );
  for (const filename of [
    "docs/release-reconciliation/canonical-history-actions-20260923.json",
    "release-migrations.json",
    "release-migration-lineage.json",
  ]) {
    assert.ok(files.has(join(ROOT, filename)), `captured reader missed ${filename}`);
  }
  assert.ok(directories.has(join(ROOT, "supabase/migrations")));
  assert.equal(result.executionForward.length, 108);
});

test("canonical history mock confines three repairs to local project and checks both ledgers", () => {
  const calls = [];
  const recordOnlyNames = planUpgrade().forward.filter((row) => REPAIRED.includes(row.version));
  let project;
  const result = rehearseUpgrade({
    canonicalHistory: true,
    currentHistory: true,
    inspectSource,
    execute(command, args, options) {
      project = options.cwd;
      calls.push({ command, args, input: options.input });
      assert.notEqual(project, ROOT);
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.equal(options.env.SUPABASE_ACCESS_TOKEN, undefined);
      assert.ok(!args.includes("--linked") && !args.includes("--db-url"));
      if (args[0] === "migration") {
        for (const row of recordOnlyNames)
          assert.equal(
            readFileSync(join(project, "supabase/migrations", row.name), "utf8"),
            HISTORY_ONLY_SENTINEL,
          );
        if (args[1] === "up")
          assert.equal(readdirSync(join(project, "supabase/migrations")).length, 209);
      }
      return { status: 0, stdout: command === "git" ? "a".repeat(40) : "", stderr: "" };
    },
  });
  const repair = calls.find((call) => call.args[0] === "migration" && call.args[1] === "repair");
  const up = calls.find((call) => call.args[0] === "migration" && call.args[1] === "up");
  assert.deepEqual(repair.args.slice(0, 7), [
    "migration",
    "repair",
    "--local",
    "--status",
    "applied",
    ...REPAIRED.slice(0, 2),
  ]);
  assert.equal(repair.args[7], REPAIRED[2]);
  assert.ok(calls.indexOf(repair) < calls.indexOf(up));
  assert.deepEqual(up.args.slice(0, 4), ["migration", "up", "--local", "--include-all"]);
  assert.equal(result.forwardMigrations.length, 108);
  const sql = calls.filter((call) => call.command === "docker");
  assert.match(sql[1].input, /upgrade_repaired_history_mismatch/u);
  assert.match(sql.at(-1).input, /upgrade_final_history_mismatch/u);
  assert.match(sql.at(-1).input, /20260903145843/u);
  assert.equal(result.canonicalHistoryProposal.productionRowsRestored, false);
  assert.match(result.canonicalHistoryProposal.historyOnlySentinelSha256, /^[a-f0-9]{64}$/u);
  assert.equal(existsSync(join(ROOT, "artifacts/release/upgrade-canonical-history.json")), true);
  assert.equal(existsSync(project), false);
});

test("canonical final scheduled catalog binds a read-only 209-version observation to its receipt", () => {
  const plan = extendProposedCanonicalHistory(
    extendCurrentHistory(planUpgrade(), readFileSync(join(ROOT, CURRENT_HISTORY_SNAPSHOT))),
  );
  const finalVersions = [
    ...plan.baseline.map((row) => row.version),
    ...plan.recordOnlyVersions,
    ...plan.executionForward.map((row) => row.version),
  ].sort();
  const baseline = JSON.parse(
    readFileSync(
      join(
        ROOT,
        "docs/release-reconciliation/evidence/scheduled-routines-live-capture-20260924.json",
      ),
      "utf8",
    ),
  );
  const final = structuredClone(baseline);
  final.capturedAt = "2026-09-28T00:00:00.000Z";
  final.ledgerVersions = finalVersions;
  final.ledgerVersionCount = finalVersions.length;
  const recurrence = final.routines.find((row) => row.name === "next_scheduled_task_occurrence");
  recurrence.volatility = "i";
  recurrence.definitionSha256 = "f".repeat(64);
  let catalogCalls = 0;
  const result = rehearseUpgrade({
    canonicalHistory: true,
    currentHistory: true,
    captureCanonicalScheduledCatalog: true,
    inspectSource,
    execute(command, args, options) {
      if (command === "git")
        return {
          status: 0,
          stdout: args.at(-1) === "HEAD^{tree}" ? "b".repeat(40) : "a".repeat(40),
        };
      if (command === "docker" && options.input === SCHEDULED_CATALOG_SQL)
        return { status: 0, stdout: JSON.stringify(++catalogCalls === 1 ? baseline : final) };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(catalogCalls, 2);
  assert.equal(result.passed, true);
  assert.equal(result.canonicalHistoryProposal.productionReleaseReady, false);
  assert.deepEqual(result.canonicalHistoryProposal.scheduledRecurrenceAssessment, {
    routine: "public.next_scheduled_task_occurrence(timestamptz,text)",
    baselineVolatility: "s",
    finalVolatility: "i",
    bodySha256Unchanged: true,
    volatilityDriftDetected: true,
    proposedProductionSequenceApproved: false,
  });
  assert.equal(result.canonicalScheduledCatalog.querySha256, SCHEDULED_CATALOG_QUERY_SHA256);
  const bytes = readFileSync(
    join(ROOT, "artifacts/release/upgrade-canonical-scheduled-catalog.json"),
  );
  assert.equal(
    result.canonicalScheduledCatalog.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  const artifact = JSON.parse(bytes);
  assert.equal(artifact.baseline.capture.ledgerVersionCount, 98);
  assert.equal(artifact.upgraded.capture.ledgerVersionCount, 209);
  assert.deepEqual(
    artifact.proposedCanonicalRecurrence,
    result.canonicalHistoryProposal.scheduledRecurrenceAssessment,
  );
  assert.equal(artifact.routineCatalogMatch, false);
  assert.ok(
    artifact.changes.some(
      (row) =>
        row.identity.includes("next_scheduled_task_occurrence") &&
        row.fields.includes("volatility"),
    ),
  );
  assert.equal(artifact.schemaProofPromoted, false);
});

test("canonical recurrence assessment rejects an unexpected baseline and never approves a plan", () => {
  const baseline = JSON.parse(
    readFileSync(
      join(
        ROOT,
        "docs/release-reconciliation/evidence/scheduled-routines-live-capture-20260924.json",
      ),
    ),
  );
  const recurrence = baseline.routines.find((row) => row.name === "next_scheduled_task_occurrence");
  const stable = assessCanonicalScheduledRecurrence(baseline, structuredClone(baseline));
  assert.equal(stable.volatilityDriftDetected, false);
  assert.equal(stable.proposedProductionSequenceApproved, false);
  const tampered = structuredClone(baseline);
  tampered.routines.find((row) => row.name === recurrence.name).volatility = "i";
  assert.throws(
    () => assessCanonicalScheduledRecurrence(tampered, baseline),
    /upgrade_canonical_scheduled_baseline_changed/u,
  );
  assert.throws(
    () => assessCanonicalScheduledRecurrence({ routines: [] }, baseline),
    /upgrade_canonical_scheduled_recurrence_missing/u,
  );
});

test("failed local history repair never starts any forward migration", () => {
  const calls = [];
  assert.throws(
    () =>
      rehearseUpgrade({
        canonicalHistory: true,
        currentHistory: true,
        inspectSource,
        execute(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "migration" && args[1] === "repair")
            return { status: 1, stdout: "", stderr: "synthetic repair failure" };
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /upgrade_local_command_failed:supabase:migration:1/u,
  );
  assert.ok(calls.some((args) => args[1] === "migration" && args[2] === "repair"));
  assert.ok(!calls.some((args) => args[1] === "migration" && args[2] === "up"));
  assert.equal(calls.at(-1)[1], "stop");
  assert.equal(existsSync(join(ROOT, "artifacts/release/upgrade-canonical-history.json")), false);
});
