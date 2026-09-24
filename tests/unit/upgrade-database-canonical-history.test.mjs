import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { extendProposedCanonicalHistory } from "../../scripts/release/upgrade-database-canonical-history.mjs";
import {
  extendCurrentHistory,
  CURRENT_HISTORY_SNAPSHOT,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import { planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPAIRED = ["20260822122000", "20260823113000", "20260903145843"];
const inspectSource = () => ({
  commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  trackedFileCount: 1,
  readFile: readFileSync,
  readDirectory: readdirSync,
});

test("canonical history rehearsal pins exactly 80 bodies and 3 equivalent history records", () => {
  const dry = rehearseUpgrade({ canonicalHistory: true, currentHistory: true, dryRun: true });
  assert.equal(dry.baselineVersions, 98);
  assert.equal(dry.pendingVersions.length, 83);
  assert.equal(dry.replayPendingVersions.length, 80);
  assert.deepEqual(dry.canonicalHistoryProposal.recordOnlyVersions, REPAIRED);
  assert.equal(dry.canonicalHistoryProposal.expectedFinalLedgerCount, 181);
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

test("canonical history mock confines three repairs to local project and checks both ledgers", () => {
  const calls = [];
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
  assert.equal(result.forwardMigrations.length, 80);
  const sql = calls.filter((call) => call.command === "docker");
  assert.match(sql[1].input, /upgrade_repaired_history_mismatch/u);
  assert.match(sql.at(-1).input, /upgrade_final_history_mismatch/u);
  assert.match(sql.at(-1).input, /20260903145843/u);
  assert.equal(result.canonicalHistoryProposal.productionRowsRestored, false);
  assert.equal(existsSync(join(ROOT, "artifacts/release/upgrade-canonical-history.json")), true);
  assert.equal(existsSync(project), false);
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
