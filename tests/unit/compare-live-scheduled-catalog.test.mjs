import assert from "node:assert/strict";
import test from "node:test";

import {
  scheduledGrantDeltas,
  validateScheduledRehearsal,
} from "../../scripts/release/compare-live-scheduled-catalog.mjs";

const roles = ["anon", "authenticated", "service_role"];
const grant = (grantee, privilege) => ({
  grantor: "postgres",
  grantee,
  privilege,
  grantable: false,
});
const table = () => ({
  schema: "public",
  name: "scheduled_tasks",
  aclIsNull: false,
  columns: [{ name: "id", aclIsNull: true }],
  acl: [grant("postgres", "SELECT")],
  columnAcl: [],
  effectivePrivileges: roles.map((role) => ({
    role,
    schemaUsage: true,
    privileges: role === "service_role" ? ["SELECT"] : [],
  })),
});
const routine = () => ({
  schema: "public",
  name: "next_scheduled_task_occurrence",
  identityArguments: "p_previous timestamp with time zone, p_repeat text",
  acl: [grant("PUBLIC", "EXECUTE"), grant("postgres", "EXECUTE")],
  effectivePrivileges: roles.map((role) => ({
    role,
    schemaUsage: true,
    execute: true,
  })),
});

test("table drift retains explicit and effective grants as separate evidence", () => {
  const original = table();
  const live = structuredClone(original);
  live.acl.unshift(grant("anon", "SELECT"));
  live.effectivePrivileges[0].privileges.push("SELECT");
  const [delta] = scheduledGrantDeltas({ tables: [original] }, { tables: [live] }, "tables");
  assert.equal(delta.identity, "public.scheduled_tasks");
  assert.deepEqual(delta.aclEntryDeltas.acl, {
    sourceOnly: [],
    liveOnly: [grant("anon", "SELECT")],
  });
  assert.deepEqual(delta.effectiveChanges, [
    {
      role: "anon",
      source: original.effectivePrivileges[0],
      live: live.effectivePrivileges[0],
    },
  ]);
  assert.equal(delta.columnAclStorageChanged, false);
  assert.equal(delta.columnEffectiveAccess, "not_captured");
});

test("routine drift does not misreport an explicit grant as new effective access", () => {
  const original = routine();
  const live = structuredClone(original);
  live.acl.splice(1, 0, grant("anon", "EXECUTE"));
  const [delta] = scheduledGrantDeltas({ routines: [original] }, { routines: [live] }, "routines");
  assert.deepEqual(delta.aclEntryDeltas.acl, {
    sourceOnly: [],
    liveOnly: [grant("anon", "EXECUTE")],
  });
  assert.deepEqual(delta.effectiveChanges, []);
});

test("deleted grants, column grants and ACL storage changes stay visible", () => {
  const original = table();
  const live = structuredClone(original);
  live.acl = [];
  live.columnAcl = [{ column: "id", ...grant("authenticated", "SELECT") }];
  live.columns[0].aclIsNull = false;
  const [delta] = scheduledGrantDeltas({ tables: [original] }, { tables: [live] }, "tables");
  assert.deepEqual(delta.aclEntryDeltas.acl.sourceOnly, [grant("postgres", "SELECT")]);
  assert.deepEqual(delta.aclEntryDeltas.columnAcl.liveOnly, [
    { column: "id", ...grant("authenticated", "SELECT") },
  ]);
  assert.equal(delta.columnAclStorageChanged, true);
  assert.deepEqual(delta.effectiveChanges, []);
  assert.equal(delta.columnEffectiveAccess, "not_captured");
});

test("new columns do not imply ACL storage drift on shared columns", () => {
  const original = table();
  const live = structuredClone(original);
  live.columns.push({ name: "additional", aclIsNull: true });
  assert.deepEqual(scheduledGrantDeltas({ tables: [original] }, { tables: [live] }, "tables"), []);
  const reverse = scheduledGrantDeltas({ tables: [live] }, { tables: [original] }, "tables");
  assert.deepEqual(reverse, []);
});

test("new routine scope exposes its grants and effective access", () => {
  const added = routine();
  added.name = "new_routine";
  added.acl.unshift(grant("anon", "EXECUTE"));
  const [delta] = scheduledGrantDeltas({ routines: [] }, { routines: [added] }, "routines");
  assert.equal(delta.kind, "added_scope");
  assert.deepEqual(delta.aclEntryDeltas.acl.liveOnly, added.acl);
  assert.equal(delta.aclEntryOrigin, "stored_or_synthesized_default");
  assert.equal(Object.hasOwn(delta, "explicitGrants"), false);
  assert.deepEqual(delta.effectiveChanges[0], {
    role: "anon",
    source: null,
    live: added.effectivePrivileges[0],
  });
});

test("identical snapshots have no drift; removed scopes retain grants", () => {
  const original = routine();
  assert.deepEqual(
    scheduledGrantDeltas(
      { routines: [original] },
      { routines: [structuredClone(original)] },
      "routines",
    ),
    [],
  );
  const [removed] = scheduledGrantDeltas({ routines: [original] }, { routines: [] }, "routines");
  assert.equal(
    removed.identity,
    JSON.stringify([original.schema, original.name, original.identityArguments]),
  );
  assert.equal(removed.kind, "removed_scope");
  assert.deepEqual(removed.aclEntryDeltas.acl.sourceOnly, original.acl);
  assert.equal(removed.aclEntryOrigin, "stored_or_synthesized_default");
  assert.deepEqual(removed.effectiveChanges[0], {
    role: "anon",
    source: original.effectivePrivileges[0],
    live: null,
  });
  assert.throws(() => scheduledGrantDeltas({}, {}, "unknown"), /grant_scope_invalid/u);
});

test("new and removed routines never label synthesized NULL-proacl defaults as explicit", () => {
  const defaultAclRoutine = routine();
  // The collector expands coalesce(proacl, acldefault(...)); a NULL proacl
  // produces these owner and PUBLIC entries with no explicit ACL storage.
  for (const [source, live] of [
    [{ routines: [] }, { routines: [defaultAclRoutine] }],
    [{ routines: [defaultAclRoutine] }, { routines: [] }],
  ]) {
    const [delta] = scheduledGrantDeltas(source, live, "routines");
    assert.equal(delta.aclEntryOrigin, "stored_or_synthesized_default");
    assert.equal(Object.hasOwn(delta, "explicitGrants"), false);
    assert.deepEqual(
      delta.aclEntryDeltas.acl[delta.kind === "added_scope" ? "liveOnly" : "sourceOnly"],
      defaultAclRoutine.acl,
    );
  }
});

test("scheduled source-final evidence rejects partial replay, reversed checkpoints and stale summaries", () => {
  const baseline = { capturedAt: "2026-09-23T10:00:00.000Z", ledgerVersions: ["20260823092107"] };
  const upgraded = {
    capturedAt: "2026-09-23T10:01:00.000Z",
    ledgerVersions: ["20260823092107", "20260823092450"],
  };
  const data = {
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
    querySha256: "c".repeat(64),
    baseline: { capture: baseline, fingerprint: "before" },
    upgraded: { capture: upgraded, fingerprint: "after" },
    changes: [{ table: "public.scheduled_tasks", fields: ["acl"] }],
    tableCatalogMatch: false,
  };
  const receipt = { replayPendingVersions: ["20260823092450"] };
  const rebuild = () => ({
    baseline: { fingerprint: "before" },
    upgraded: { fingerprint: "after" },
    changes: [{ table: "public.scheduled_tasks", fields: ["acl"] }],
    tableCatalogMatch: false,
    querySha256: data.querySha256,
  });
  assert.doesNotThrow(() =>
    validateScheduledRehearsal(receipt, data, rebuild, "tableCatalogMatch"),
  );
  for (const replayPendingVersions of [[], ["20260823092450", "20260901000000"]])
    assert.throws(
      () =>
        validateScheduledRehearsal({ replayPendingVersions }, data, rebuild, "tableCatalogMatch"),
      /artifact_checkpoint_mismatch/u,
    );
  const reversed = structuredClone(data);
  reversed.upgraded.capture.capturedAt = "2026-09-23T09:59:00.000Z";
  assert.throws(
    () => validateScheduledRehearsal(receipt, reversed, rebuild, "tableCatalogMatch"),
    /artifact_checkpoint_mismatch/u,
  );
  for (const tampered of [
    { ...data, changes: [] },
    { ...data, tableCatalogMatch: true },
    { ...data, upgraded: { ...data.upgraded, fingerprint: "forged" } },
  ])
    assert.throws(
      () => validateScheduledRehearsal(receipt, tampered, rebuild, "tableCatalogMatch"),
      /artifact_fingerprint_mismatch/u,
    );
});
