import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const module = loadUiModule(
  "src/lib/team-account-deletion.server.ts",
  { "./supabase-loose": { loose: (client) => client } },
  { AbortSignal },
);
function fixture(result) {
  const calls = [];
  const q = {
    select(...args) {
      calls.push(["select", ...args]);
      return this;
    },
    update(value) {
      calls.push(["update", value]);
      return this;
    },
    eq(...args) {
      calls.push(["eq", ...args]);
      return this;
    },
    async abortSignal() {
      return result;
    },
  };
  return {
    calls,
    admin: {
      from(table) {
        calls.push(["from", table]);
        return q;
      },
    },
  };
}
test("account retirement reads only the verified owner's durable Team customer mapping", async () => {
  const f = fixture({ data: [{ customer_id: "cus_Team" }], error: null });
  assert.deepEqual(
    [...(await module.teamCustomersForAccountDeletion(f.admin, "owner"))],
    ["cus_Team"],
  );
  assert.ok(f.calls.some((c) => c[0] === "eq" && c[1] === "owner_id" && c[2] === "owner"));
});
test("missing pre-rollout tables are empty; transport failures and malformed identities fail closed", async () => {
  assert.deepEqual(
    [
      ...(await module.teamCustomersForAccountDeletion(
        fixture({ error: { code: "42P01" } }).admin,
        "owner",
      )),
    ],
    [],
  );
  for (const result of [
    { error: { code: "08006" } },
    { data: [{ customer_id: "not-a-customer" }], error: null },
    { data: [{ customer_id: "cus_A" }, { customer_id: "cus_A" }], error: null },
  ])
    await assert.rejects(module.teamCustomersForAccountDeletion(fixture(result).admin, "owner"));
});
test("confirmed retirement revokes Team entitlements through the exact owner/customer pair", async () => {
  const f = fixture({ error: null });
  await module.acknowledgeTeamCustomerRetired(f.admin, "owner", "cus_Team");
  assert.ok(f.calls.some((c) => c[0] === "eq" && c[1] === "customer_id" && c[2] === "cus_Team"));
  assert.equal(f.calls.find((c) => c[0] === "update")[1].billing_hold, true);
  await assert.rejects(
    module.acknowledgeTeamCustomerRetired(
      fixture({ error: { code: "08006" } }).admin,
      "owner",
      "cus_Team",
    ),
  );
});
