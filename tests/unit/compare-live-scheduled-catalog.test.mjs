import assert from "node:assert/strict";
import test from "node:test";

import { scheduledGrantDeltas } from "../../scripts/release/compare-live-scheduled-catalog.mjs";

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
  assert.deepEqual(delta.explicitGrants.acl, {
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
});

test("routine drift does not misreport an explicit grant as new effective access", () => {
  const original = routine();
  const live = structuredClone(original);
  live.acl.splice(1, 0, grant("anon", "EXECUTE"));
  const [delta] = scheduledGrantDeltas({ routines: [original] }, { routines: [live] }, "routines");
  assert.deepEqual(delta.explicitGrants.acl, {
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
  assert.deepEqual(delta.explicitGrants.acl.sourceOnly, [grant("postgres", "SELECT")]);
  assert.deepEqual(delta.explicitGrants.columnAcl.liveOnly, [
    { column: "id", ...grant("authenticated", "SELECT") },
  ]);
  assert.equal(delta.columnAclStorageChanged, true);
});

test("identical snapshots have no drift; missing scopes remain visible", () => {
  const original = routine();
  assert.deepEqual(
    scheduledGrantDeltas(
      { routines: [original] },
      { routines: [structuredClone(original)] },
      "routines",
    ),
    [],
  );
  assert.deepEqual(scheduledGrantDeltas({ routines: [original] }, { routines: [] }, "routines"), [
    {
      identity: JSON.stringify([original.schema, original.name, original.identityArguments]),
      kind: "removed_scope",
    },
  ]);
  assert.throws(() => scheduledGrantDeltas({}, {}, "unknown"), /grant_scope_invalid/u);
});
