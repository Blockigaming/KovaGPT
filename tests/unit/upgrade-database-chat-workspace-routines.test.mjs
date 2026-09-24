import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
  CHAT_WORKSPACE_CATALOG_SQL,
  CHAT_WORKSPACE_ROUTINE_NAMES,
  buildChatWorkspaceCatalogEvidence,
  parseChatWorkspaceCatalogCapture,
  validateChatWorkspaceCatalogCapture,
} from "../../scripts/release/upgrade-database-chat-workspace-routines.mjs";
import { rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";

const BASE = ["20260823151901", "20260824085042", "20260824085444"];
const FINAL = [...BASE, "20260905005111"];
const HASH = "a".repeat(64);
const ROLES = ["anon", "authenticated", "service_role"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const routine = (name) => ({
  schema: "public",
  name,
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
  acl: [{ grantor: "postgres", grantee: "authenticated", privilege: "EXECUTE", grantable: false }],
  effectivePrivileges: ROLES.map((role) => ({
    role,
    schemaUsage: true,
    execute: role !== "anon",
  })),
});
const capture = (versions = BASE) => ({
  schemaVersion: 1,
  captureKind: "chat-workspace-routine-catalog",
  capturedAt: "2026-09-23T18:00:00.000Z",
  postgresVersionNum: 170006,
  databaseName: "postgres",
  readOnly: true,
  isolation: "repeatable read",
  publicSchemaPresent: true,
  catalogSentinelPresent: true,
  ledgerVersionCount: versions.length,
  ledgerVersions: [...versions],
  routineCount: 1,
  routines: [routine("create_chat_branch")],
});
const build = (before = capture(), after = capture(FINAL)) =>
  buildChatWorkspaceCatalogEvidence({
    baseline: before,
    upgraded: after,
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit: "b".repeat(40),
    sourceTree: "c".repeat(40),
  });

test("Day-15 routine query inventories overloads, roles and body hashes without invoking RPCs", () => {
  assert.equal(CHAT_WORKSPACE_CATALOG_QUERY_SHA256, sha256(CHAT_WORKSPACE_CATALOG_SQL));
  assert.match(
    CHAT_WORKSPACE_CATALOG_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(CHAT_WORKSPACE_CATALOG_SQL, /lower\(p\.proname::text\)/u);
  assert.match(CHAT_WORKSPACE_CATALOG_SQL, /pg_get_functiondef/u);
  assert.match(CHAT_WORKSPACE_CATALOG_SQL, /has_function_privilege/u);
  assert.ok(CHAT_WORKSPACE_ROUTINE_NAMES.includes("utf16_code_unit_length"));
  assert.ok(CHAT_WORKSPACE_ROUTINE_NAMES.includes("kova_record_message_version"));
  assert.doesNotMatch(CHAT_WORKSPACE_CATALOG_SQL, /from\s+(?:public|auth|storage|vault)\./iu);
  assert.doesNotMatch(
    CHAT_WORKSPACE_CATALOG_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy)\s+(?:into|table|schema|function|public\.)/iu,
  );
});

test("Day-15 routine comparison exposes changed body and privilege, no promotion", () => {
  const equivalent = build();
  assert.equal(equivalent.routineCatalogMatch, true);
  assert.equal(equivalent.schemaProofPromoted, false);
  assert.deepEqual(equivalent.baseline.fingerprint, equivalent.upgraded.fingerprint);
  const after = capture(FINAL);
  after.routines[0].definitionSha256 = "d".repeat(64);
  after.routines[0].effectivePrivileges[0].execute = true;
  const changed = build(capture(), after);
  assert.equal(changed.routineCatalogMatch, false);
  assert.notEqual(
    changed.baseline.fingerprint.routineSha256,
    changed.upgraded.fingerprint.routineSha256,
  );
  assert.notEqual(changed.baseline.fingerprint.aclSha256, changed.upgraded.fingerprint.aclSha256);
  assert.deepEqual(
    changed.changes.map((c) => c.fields),
    [["definitionSha256", "effectivePrivileges"]],
  );
});

test("Day-15 routine capture rejects mismatched ledger, extra fields, forged metadata and duplicates", () => {
  assert.equal(validateChatWorkspaceCatalogCapture(capture(), BASE).routineCount, 1);
  assert.equal(parseChatWorkspaceCatalogCapture(JSON.stringify(capture()), BASE).routineCount, 1);
  for (const change of [
    (c) => {
      c.readOnly = false;
    },
    (c) => {
      c.ledgerVersions.reverse();
    },
    (c) => {
      c.routines[0].definitionSha256 = "invalid";
    },
    (c) => {
      c.routines[0].customerMessage = "private";
    },
    (c) => {
      c.routines[0].schema = "pg_catalog";
      c.routines[0].name = "other";
    },
    (c) => {
      c.routines.push({ ...c.routines[0] });
      c.routineCount = 2;
    },
  ]) {
    const candidate = capture();
    change(candidate);
    assert.throws(() => validateChatWorkspaceCatalogCapture(candidate, BASE));
  }
  const after = capture(FINAL);
  after.capturedAt = "2026-09-22T17:00:00.000Z";
  assert.throws(() => build(capture(), after));
});

test("Day-15 routine capture is scheduled on current-history isolated replay", () => {
  const dry = rehearseUpgrade({
    dryRun: true,
    currentHistory: true,
    captureChatWorkspaceRoutines: true,
  });
  assert.equal(dry.chatWorkspaceRoutinesPlanned, true);
  assert.equal(dry.chatWorkspaceRoutinesQuerySha256, CHAT_WORKSPACE_CATALOG_QUERY_SHA256);
  assert.equal(dry.executed, false);
  assert.throws(
    () => rehearseUpgrade({ dryRun: true, captureChatWorkspaceRoutines: true }),
    /upgrade_chat_workspace_routines_current_history_required/u,
  );
});
