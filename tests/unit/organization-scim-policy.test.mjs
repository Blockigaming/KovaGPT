import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIM_SCHEMA,
  ScimError,
  parseScimResource,
  parseScimQuery,
  scimIfMatch,
  applyScimPatch,
  scimDiscovery,
} from "../../src/lib/scim/policy.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const user = {
  schemas: [SCIM_SCHEMA.user],
  externalId: "immutable-subject",
  userName: "person@example.com",
  displayName: "Person",
  active: true,
};
test("SCIM parsers reject unsupported fields, malformed types, excessive members, unsafe filters and unconditional mutations", () => {
  for (const value of [
    { ...user, password: "hidden" },
    { ...user, emails: [{ value: 7 }] },
    { ...user, active: "true" },
    { ...user, externalId: "" },
    { ...user, schemas: [SCIM_SCHEMA.user, "unknown"] },
  ])
    assert.throws(() => parseScimResource("Users", value), ScimError);
  assert.throws(
    () =>
      parseScimResource("Groups", {
        schemas: [SCIM_SCHEMA.group],
        externalId: "g",
        displayName: "G",
        members: Array(101).fill({ value: id }),
      }),
    ScimError,
  );
  for (const query of [
    "?count=101",
    "?startIndex=0",
    "?count=1&count=2",
    "?filter=userName%20co%20%22person%22",
    "?filter=displayName%20eq%20%22Person%22",
    "?sortBy=id",
  ])
    assert.throws(() => parseScimQuery("https://example.com" + query, "Users"), ScimError);
  assert.throws(
    () => scimIfMatch(null),
    (error) => error.status === 428,
  );
  assert.throws(() => scimIfMatch('"1"'), ScimError);
  assert.equal(scimIfMatch('W/"12"'), 12);
  assert.deepEqual(
    parseScimQuery("https://example.com?count=0&filter=externalId%20eq%20%22subject%22", "Users"),
    { count: 0, startIndex: 1, filter: { field: "externalId", value: "subject" } },
  );
});
test("SCIM PATCH preserves immutable subject and applies bounded member changes atomically", () => {
  const patch = (Operations) => ({ schemas: [SCIM_SCHEMA.patch], Operations });
  const changed = applyScimPatch(
    "Users",
    { ...user, emails: [{ value: user.userName }] },
    patch([
      { op: "replace", path: "userName", value: "changed@example.com" },
      { op: "replace", path: "active", value: false },
    ]),
  );
  assert.equal(changed.userName, "changed@example.com");
  assert.equal(changed.active, false);
  assert.equal(changed.externalId, user.externalId);
  assert.throws(
    () =>
      applyScimPatch(
        "Users",
        user,
        patch([{ op: "replace", path: "externalId", value: "attacker" }]),
      ),
    ScimError,
  );
  const group = {
    schemas: [SCIM_SCHEMA.group],
    externalId: "g",
    displayName: "Group",
    members: [{ value: id }],
  };
  assert.deepEqual(
    applyScimPatch("Groups", group, patch([{ op: "remove", path: `members[value eq "${id}"]` }]))
      .members,
    [],
  );
  assert.deepEqual(
    applyScimPatch("Groups", group, patch([{ op: "add", path: "members", value: [{ value: id }] }]))
      .members,
    [{ value: id }],
  );
  assert.equal(scimDiscovery("ResourceTypes").Resources.length, 2);
  assert.equal(scimDiscovery("Schemas", SCIM_SCHEMA.user).id, SCIM_SCHEMA.user);
});
