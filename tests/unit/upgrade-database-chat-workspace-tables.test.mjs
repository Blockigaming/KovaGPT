import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CHAT_WORKSPACE_TABLE_NAMES,
  CHAT_WORKSPACE_TABLE_QUERY_SHA256,
  CHAT_WORKSPACE_TABLE_SQL,
  buildChatWorkspaceTableEvidence,
  parseChatWorkspaceTableCapture,
  validateChatWorkspaceTableCapture,
} from "../../scripts/release/upgrade-database-chat-workspace-tables.mjs";
import { rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";

const BASE = ["20260823151901", "20260824085042", "20260824085444"];
const FINAL = [...BASE, "20260905005111"];
const SHA = "a".repeat(64);
const ROLES = ["anon", "authenticated", "service_role"];
const hash = (value) => createHash("sha256").update(value).digest("hex");

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
        defaultSha256: SHA,
        collation: null,
      },
    ],
    constraints: [
      {
        name: `${name}_pkey`,
        kind: "p",
        validated: true,
        deferrable: false,
        initiallyDeferred: false,
        definitionSha256: SHA,
      },
    ],
    inboundForeignKeys: [],
    indexes: [
      {
        name: `${name}_pkey`,
        primary: true,
        unique: true,
        valid: true,
        ready: true,
        replicaIdentity: false,
        clustered: false,
        nullsNotDistinct: false,
        definitionSha256: SHA,
      },
    ],
    aclIsNull: false,
    acl: [{ grantor: "postgres", grantee: "service_role", privilege: "SELECT", grantable: false }],
    columnAcl: [],
    effectivePrivileges: ROLES.map((role) => ({
      role,
      schemaUsage: true,
      privileges: role === "service_role" ? ["SELECT"] : [],
    })),
    policies: [
      {
        name: "owner_read",
        command: "r",
        permissive: true,
        roles: ["authenticated"],
        usingSha256: SHA,
        checkSha256: null,
      },
    ],
    triggers: [
      {
        name: "touch",
        enabled: "O",
        function: "public.touch_updated_at()",
        functionOwner: "postgres",
        definitionSha256: SHA,
        functionDefinitionSha256: SHA,
      },
    ],
  };
}

function capture(versions = BASE) {
  return {
    schemaVersion: 1,
    captureKind: "chat-workspace-table-catalog",
    capturedAt: "2026-09-23T18:00:00.000Z",
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: versions.length,
    ledgerVersions: [...versions],
    tableCount: 4,
    tables: CHAT_WORKSPACE_TABLE_NAMES.map(table),
  };
}

function build(before = capture(), after = capture(FINAL)) {
  return buildChatWorkspaceTableEvidence({
    baseline: before,
    upgraded: after,
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit: "b".repeat(40),
    sourceTree: "c".repeat(40),
  });
}

test("Day-15 collector captures only fixed catalog metadata with a read-only snapshot", () => {
  assert.deepEqual(CHAT_WORKSPACE_TABLE_NAMES, [
    "chat_branches",
    "chat_custom_rules",
    "chat_message_versions",
    "chat_pinned_files",
  ]);
  assert.equal(CHAT_WORKSPACE_TABLE_QUERY_SHA256, hash(CHAT_WORKSPACE_TABLE_SQL));
  assert.match(
    CHAT_WORKSPACE_TABLE_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(CHAT_WORKSPACE_TABLE_SQL, /set local statement_timeout = '10s'/u);
  assert.match(CHAT_WORKSPACE_TABLE_SQL, /pg_policy/u);
  assert.match(CHAT_WORKSPACE_TABLE_SQL, /pg_trigger/u);
  assert.match(CHAT_WORKSPACE_TABLE_SQL, /has_table_privilege/u);
  assert.doesNotMatch(CHAT_WORKSPACE_TABLE_SQL, /from\s+(?:public|auth|storage|vault)\./iu);
  assert.doesNotMatch(
    CHAT_WORKSPACE_TABLE_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy)\s+(?:into|table|schema|function|public\.)/iu,
  );
});

test("Day-15 table catalog differences surface and cannot promote a blocked mapping", () => {
  const evidence = build();
  assert.deepEqual(evidence.baseline.fingerprint, evidence.upgraded.fingerprint);
  assert.equal(evidence.tableCatalogMatch, true);
  assert.equal(evidence.schemaProofPromoted, false);
  assert.equal(evidence.liveCatalogCompared, false);
  const after = capture(FINAL);
  after.tables[0].columns[0].defaultSha256 = "d".repeat(64);
  after.tables[2].policies[0].usingSha256 = "e".repeat(64);
  const changed = build(capture(), after);
  assert.equal(changed.tableCatalogMatch, false);
  assert.notDeepEqual(changed.baseline.fingerprint.schema, changed.upgraded.fingerprint.schema);
  assert.notDeepEqual(changed.baseline.fingerprint.rls, changed.upgraded.fingerprint.rls);
  assert.deepEqual(
    changed.changes.map((item) => item.table),
    ["public.chat_branches", "public.chat_message_versions"],
  );
});

test("Day-15 table capture rejects malformed catalog, ledger, chronology and untrusted row fields", () => {
  assert.equal(validateChatWorkspaceTableCapture(capture(), BASE).tableCount, 4);
  assert.equal(parseChatWorkspaceTableCapture(JSON.stringify(capture()), BASE).tableCount, 4);
  for (const change of [
    (c) => {
      c.readOnly = false;
    },
    (c) => {
      c.isolation = "read committed";
    },
    (c) => {
      c.tables.pop();
      c.tableCount = 3;
    },
    (c) => {
      c.tables[0].columns[0].name = "";
    },
    (c) => {
      c.tables[0].messages = ["private"];
    },
    (c) => {
      c.tables[0].policies[0].usingSha256 = "not-a-hash";
    },
    (c) => {
      c.ledgerVersions.reverse();
    },
  ]) {
    const candidate = capture();
    change(candidate);
    assert.throws(() => validateChatWorkspaceTableCapture(candidate, BASE));
  }
  const after = capture(FINAL);
  after.capturedAt = "2026-09-22T17:00:00.000Z";
  assert.throws(() => build(capture(), after));
});

test("Day-15 catalog capture is scheduled in the current-history isolated replay", () => {
  const dry = rehearseUpgrade({
    dryRun: true,
    currentHistory: true,
    captureChatWorkspaceTables: true,
  });
  assert.equal(dry.chatWorkspaceTablesPlanned, true);
  assert.equal(dry.chatWorkspaceTablesQuerySha256, CHAT_WORKSPACE_TABLE_QUERY_SHA256);
  assert.equal(dry.executed, false);
  assert.throws(
    () => rehearseUpgrade({ dryRun: true, captureChatWorkspaceTables: true }),
    /upgrade_chat_workspace_tables_current_history_required/u,
  );
});
