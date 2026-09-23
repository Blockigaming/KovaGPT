import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareLiveChatWorkspaceCatalog } from "../../scripts/release/compare-live-chat-workspace-catalog.mjs";
import {
  CHAT_WORKSPACE_TABLE_FILE,
  CHAT_WORKSPACE_TABLE_NAMES,
  CHAT_WORKSPACE_TABLE_QUERY_SHA256,
  buildChatWorkspaceTableEvidence,
} from "../../scripts/release/upgrade-database-chat-workspace-tables.mjs";
import {
  CHAT_WORKSPACE_CATALOG_FILE,
  CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
  buildChatWorkspaceCatalogEvidence,
} from "../../scripts/release/upgrade-database-chat-workspace-routines.mjs";
import { DAY15_CHAT_DATA_QUERY_SHA256 } from "../../scripts/release/day15-chat-data-violations.mjs";

const BASE = ["20260823151901", "20260824085042", "20260824085444"];
const FINAL = [...BASE, "20260905005111"];
const HASH = "a".repeat(64);
const SOURCE_COMMIT = "b".repeat(40),
  SOURCE_TREE = "c".repeat(40);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const roles = ["anon", "authenticated", "service_role"];

function table(name) {
  return {
    schema: "public",
    name,
    kind: "r",
    owner: "postgres",
    persistence: "p",
    rowSecurity: true,
    forceRowSecurity: false,
    replicaIdentity: "d",
    partition: false,
    parentCount: 0,
    attributeSlots: 1,
    droppedColumns: [],
    columns: [
      {
        ordinal: 1,
        name: "id",
        type: "uuid",
        dimensions: 0,
        notNull: true,
        identity: "",
        generated: "",
        aclIsNull: true,
        defaultSha256: HASH,
        collation: null,
      },
    ],
    constraints: [],
    inboundForeignKeys: [],
    indexes: [],
    aclIsNull: false,
    acl: [],
    columnAcl: [],
    effectivePrivileges: roles.map((role) => ({
      role,
      schemaUsage: true,
      privileges: role === "service_role" ? ["SELECT"] : [],
    })),
    policies: [],
    triggers: [],
  };
}

function routine() {
  return {
    schema: "public",
    name: "create_chat_branch",
    kind: "f",
    identityArguments: "p_chat_id text",
    result: "jsonb",
    owner: "postgres",
    language: "plpgsql",
    securityDefiner: false,
    strict: false,
    volatility: "v",
    parallel: "u",
    leakproof: false,
    returnsSet: false,
    defaultArgumentCount: 0,
    bodyBytes: 20,
    bodySha256: HASH,
    definitionSha256: HASH,
    searchPath: ["search_path=pg_catalog, public, pg_temp"],
    configurationSha256: HASH,
    acl: [],
    effectivePrivileges: roles.map((role) => ({
      role,
      schemaUsage: true,
      execute: role !== "anon",
    })),
  };
}

function capture(kind, versions, capturedAt) {
  return {
    schemaVersion: 1,
    captureKind: `chat-workspace-${kind}-catalog`,
    capturedAt,
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: versions.length,
    ledgerVersions: [...versions],
    ...(kind === "table"
      ? { tableCount: 4, tables: CHAT_WORKSPACE_TABLE_NAMES.map(table) }
      : { routineCount: 1, routines: [routine()] }),
  };
}

const zeroCounts = {
  chat_branches: {
    bad_chat_id: 0,
    bad_conversation_id: 0,
    negative_message_index: 0,
    oversized_message_id_array: 0,
    self_parent: 0,
    wrong_parent_scope: 0,
    multiple_active: 0,
  },
  chat_custom_rules: { bad_chat_id: 0, bad_instruction: 0, missing_owner: 0 },
  chat_message_versions: {
    bad_chat_id: 0,
    bad_message_id: 0,
    bad_source: 0,
    retired_regeneration: 0,
    oversized_instruction: 0,
    oversized_or_missing_content: 0,
    bad_selection_pair: 0,
    wrong_branch_scope: 0,
    multiple_accepted: 0,
  },
  chat_pinned_files: {
    bad_chat_id: 0,
    bad_status: 0,
    retired_ready: 0,
    bad_source_project: 0,
    missing_owner: 0,
  },
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "chat-workspace-compare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, data) => {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(data) + "\n");
    return { path, sha256: digest(readFileSync(path)) };
  };
  const tableArtifact = file(
    CHAT_WORKSPACE_TABLE_FILE,
    buildChatWorkspaceTableEvidence({
      baseline: capture("table", BASE, "2026-09-23T10:00:00.000Z"),
      upgraded: capture("table", FINAL, "2026-09-23T11:00:00.000Z"),
      baselineVersions: BASE,
      finalVersions: FINAL,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
    }),
  );
  const routineArtifact = file(
    CHAT_WORKSPACE_CATALOG_FILE,
    buildChatWorkspaceCatalogEvidence({
      baseline: capture("routine", BASE, "2026-09-23T10:00:00.000Z"),
      upgraded: capture("routine", FINAL, "2026-09-23T11:00:00.000Z"),
      baselineVersions: BASE,
      finalVersions: FINAL,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
    }),
  );
  const receipt = file("upgrade-database.json", {
    passed: true,
    executed: true,
    sourceCommit: SOURCE_COMMIT,
    baselineVersions: BASE.length,
    currentHistory: { requiresCanonicalHistoryReconciliation: true, productionReleaseReady: false },
    chatWorkspaceTables: {
      file: CHAT_WORKSPACE_TABLE_FILE,
      sha256: tableArtifact.sha256,
      querySha256: CHAT_WORKSPACE_TABLE_QUERY_SHA256,
    },
    chatWorkspaceRoutines: {
      file: CHAT_WORKSPACE_CATALOG_FILE,
      sha256: routineArtifact.sha256,
      querySha256: CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
    },
  });
  const liveTable = file("live-tables.json", capture("table", BASE, "2026-09-23T12:00:00.000Z"));
  const liveRoutine = file(
    "live-routines.json",
    capture("routine", BASE, "2026-09-23T12:00:00.000Z"),
  );
  const liveData = file("live-data.json", {
    schemaVersion: 1,
    captureKind: "chat-workspace-aggregate-violations",
    projectId: "mfbycmbjygcfkrsuepxf",
    capturedAt: "2026-09-23T12:01:00.000Z",
    catalogLedgerSha256: digest(BASE.join("\n")),
    querySha256: DAY15_CHAT_DATA_QUERY_SHA256,
    counts: zeroCounts,
    observedViolationCount: 0,
    schemaProofPromoted: false,
    productionReleaseReady: false,
  });
  return {
    receiptPath: receipt.path,
    tableArtifactPath: tableArtifact.path,
    routineArtifactPath: routineArtifact.path,
    liveTablePath: liveTable.path,
    liveRoutinePath: liveRoutine.path,
    liveDataPath: liveData.path,
  };
}

test("Day-15 live comparison binds receipts, ledger and both catalog scopes without promotion", (t) => {
  const paths = fixture(t);
  const comparison = compareLiveChatWorkspaceCatalog(paths);
  assert.equal(comparison.liveLedgerVersionCount, BASE.length);
  assert.deepEqual(comparison.tables.baselineVsLive, []);
  assert.deepEqual(comparison.routines.sourceFinalVsLive, []);
  assert.equal(comparison.liveData.observedViolationCount, 0);
  assert.equal(comparison.liveCatalogCompared, true);
  assert.equal(comparison.schemaProofPromoted, false);
});

test("Day-15 live comparison rejects artifact, ledger, chronology and data tampering", (t) => {
  const paths = fixture(t);
  const mutate = (path, callback) => {
    const original = readFileSync(path, "utf8");
    const candidate = JSON.parse(original);
    callback(candidate);
    writeFileSync(path, JSON.stringify(candidate) + "\n");
    assert.throws(() => compareLiveChatWorkspaceCatalog(paths));
    writeFileSync(path, original);
  };
  mutate(paths.receiptPath, (r) => {
    r.chatWorkspaceTables.sha256 = HASH;
  });
  mutate(paths.tableArtifactPath, (a) => {
    a.upgraded.capture.readOnly = false;
  });
  mutate(paths.routineArtifactPath, (a) => {
    a.upgraded.fingerprint.aclSha256 = HASH;
  });
  mutate(paths.liveTablePath, (a) => {
    a.ledgerVersions.pop();
    a.ledgerVersionCount--;
  });
  mutate(paths.liveRoutinePath, (a) => {
    a.capturedAt = "2026-09-23T09:00:00.000Z";
  });
  mutate(paths.liveDataPath, (a) => {
    a.counts.customer_id = "private";
  });
  mutate(paths.liveDataPath, (a) => {
    a.customerContent = "must reject additional top-level data";
  });
  mutate(paths.liveDataPath, (a) => {
    a.capturedAt = "2026-09-23T11:00:00.000Z";
  });
  mutate(paths.liveDataPath, (a) => {
    a.projectId = "wrong-project";
  });
  mutate(paths.liveDataPath, (a) => {
    a.catalogLedgerSha256 = HASH;
  });
});
