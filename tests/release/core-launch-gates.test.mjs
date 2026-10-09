import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  CORE_LAUNCH_SCOPE,
  CORE_LAUNCH_REQUIRED_GATES,
  PLUGIN_OPERATIONS,
  coreLaunchBlockers,
} from "../../scripts/release/core-launch-gates.mjs";
import { LAUNCH_PLUGIN_IDS } from "../../src/lib/core-launch-policy.mjs";

const commit = "a".repeat(40);
function receipt() {
  const entry = { status: "passed", commit, target: "staging" };
  return {
    schemaVersion: 2,
    commit,
    target: "staging",
    scope: {
      id: CORE_LAUNCH_SCOPE,
      paidSubscriptions: false,
      imageGeneration: false,
      plugins: [...LAUNCH_PLUGIN_IDS],
    },
    entries: Object.fromEntries(
      [...CORE_LAUNCH_REQUIRED_GATES, "stripe", "accessLimits", "images", "imageCostControls"].map(
        (name) => [
          name,
          { ...entry, ...(name === "authenticatedCrud" ? { cleanup: "cleaned" } : {}) },
        ],
      ),
    ),
    plugins: Object.fromEntries(
      LAUNCH_PLUGIN_IDS.map((id) => [
        id,
        {
          commit,
          target: "staging",
          ...Object.fromEntries(PLUGIN_OPERATIONS.map((op) => [op, "passed"])),
        },
      ]),
    ),
  };
}

test("complete reduced-scope receipt passes without deferred models, agents or catalog entries", () => {
  const value = receipt();
  assert.equal(value.scope.plugins.length, 13);
  assert.deepEqual(coreLaunchBlockers(value), []);
});
test("old aggregate staging success cannot bypass required customer journeys", () => {
  const value = receipt();
  for (const name of [
    "authentication",
    "conversations",
    "projectsFiles",
    "providers",
    "scheduledTasks",
    "settingsLegal",
  ]) {
    delete value.entries[name];
    assert.ok(coreLaunchBlockers(value).includes(`gates.${name}`));
  }
});
test("aggregate connector pass does not substitute for any of the thirteen actual integrations", () => {
  for (const id of LAUNCH_PLUGIN_IDS)
    for (const operation of PLUGIN_OPERATIONS) {
      const value = receipt();
      value.plugins[id][operation] = "not-run";
      assert.ok(coreLaunchBlockers(value).includes(`plugins.${id}.${operation}`));
    }
});
test("planned and setup-only plugins never pass launch acceptance", () => {
  for (const status of ["planned", "setup_required", "unavailable", "skipped", "failed"]) {
    const value = receipt();
    value.plugins.notion.connect = status;
    assert.ok(coreLaunchBlockers(value).includes("plugins.notion.connect"));
  }
});
test("scope must contain exactly the selected services without duplicates", () => {
  for (const plugins of [
    LAUNCH_PLUGIN_IDS.slice(1),
    [...LAUNCH_PLUGIN_IDS, "dropbox"],
    [...LAUNCH_PLUGIN_IDS.slice(1), "github"],
  ]) {
    const value = receipt();
    value.scope.plugins = plugins;
    assert.ok(coreLaunchBlockers(value).includes("scope.plugins"));
  }
});
test("local or other-commit results do not establish staging verification", () => {
  const value = receipt();
  value.entries.conversations.target = "local";
  value.entries.projectsFiles.commit = "b".repeat(40);
  value.plugins.gmail.target = "fixture";
  value.plugins.github.commit = "b".repeat(40);
  for (const expected of [
    "provenance.conversations",
    "provenance.projectsFiles",
    "plugins.gmail.provenance",
    "plugins.github.provenance",
  ])
    assert.ok(coreLaunchBlockers(value).includes(expected));
});
test("paid launch requires both checkout/webhook verification and server access limits", () => {
  const value = receipt();
  value.scope.paidSubscriptions = true;
  value.entries.stripe.status = "not-run";
  value.entries.accessLimits.status = "not-run";
  assert.ok(coreLaunchBlockers(value).includes("gates.stripe"));
  assert.ok(coreLaunchBlockers(value).includes("gates.accessLimits"));
  value.scope.paidSubscriptions = false;
  assert.deepEqual(coreLaunchBlockers(value), []);
});
test("optional image launch requires generation and cost-control verification together", () => {
  const value = receipt();
  value.scope.imageGeneration = true;
  value.entries.images.status = "not-run";
  value.entries.imageCostControls.status = "not-run";
  assert.ok(coreLaunchBlockers(value).includes("gates.images"));
  assert.ok(coreLaunchBlockers(value).includes("gates.imageCostControls"));
  value.scope.imageGeneration = false;
  assert.deepEqual(coreLaunchBlockers(value), []);
});
test("missing or malformed scope and legacy receipts fail closed", () => {
  assert.ok(coreLaunchBlockers(null).length > 0);
  for (const change of [
    (v) => {
      v.schemaVersion = 1;
    },
    (v) => {
      v.target = "local";
    },
    (v) => {
      v.commit = "";
    },
    (v) => {
      v.scope.paidSubscriptions = "false";
    },
    (v) => {
      v.scope.imageGeneration = undefined;
    },
    (v) => {
      v.entries.authenticatedCrud.cleanup = "orphaned";
    },
  ]) {
    const value = receipt();
    change(value);
    assert.ok(coreLaunchBlockers(value).length > 0);
  }
});

test("the real promotion guard rejects an approved aggregate receipt with an unverified plugin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kova-launch-guard-test-"));
  try {
    const value = receipt();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    value.commit = head;
    for (const entry of [...Object.values(value.entries), ...Object.values(value.plugins)])
      entry.commit = head;
    value.launchReady = true;
    value.plugins.hubspot.read = "not-run";
    const raw = JSON.stringify(value);
    const path = join(directory, "receipt.json");
    await writeFile(path, raw);
    const result = spawnSync(process.execPath, ["scripts/release/production-guard.mjs"], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        KOVA_APPROVED_LAUNCH_REPORT: path,
        KOVA_APPROVED_LAUNCH_REPORT_SHA256: createHash("sha256").update(raw).digest("hex"),
        KOVA_PRODUCTION_HUMAN_APPROVAL: "APPROVED",
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /plugins\.hubspot\.read/);
    assert.doesNotMatch(result.stdout, /Production guard approved/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the real report generator leaves missing staging journeys and selected plugins blocked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kova-launch-report-test-"));
  try {
    const gitDirectory = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^KOVA_(GATE_|PLUGIN_|LAUNCH_|STAGING_|SMOKE_|RELEASE_)/.test(name),
      ),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/release/launch-report.mjs", import.meta.url))],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...env, GIT_DIR: gitDirectory, KOVA_RELEASE_TARGET: "staging" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(
      await readFile(join(directory, "artifacts/release/launch-report.json"), "utf8"),
    );
    assert.equal(value.launchReady, false);
    assert.deepEqual(value.scope.plugins, [...LAUNCH_PLUGIN_IDS]);
    assert.equal(value.scope.paidSubscriptions, false);
    assert.equal(value.scope.imageGeneration, false);
    assert.ok(value.blockers.includes("gates.conversations"));
    assert.ok(value.blockers.includes("plugins.gmail.read"));
    assert.equal(value.entries.production.productionValidated, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
