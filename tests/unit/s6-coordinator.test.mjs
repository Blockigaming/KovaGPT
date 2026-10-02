import assert from "node:assert/strict";
import test from "node:test";
import {
  executeS6,
  acceptOwnerReceipt,
  OWNER_CHECKS,
} from "../../scripts/release/s6-coordinator.mjs";

function fixture() {
  const now = Date.now(),
    events = [],
    sourceSha = "a".repeat(40);
  const run = {
    runId: "abcdef012345",
    sourceSha,
    records: [],
    liveDeadline: now + 1000000,
    ownerFixture: { createdAfter: new Date(now - 1000).toISOString() },
    ownerDeadline: now + 700000,
    save() {},
    app: async () => ({ status: 200, data: { sha: sourceSha } }),
    prepareOwner: () => ({ deadline: now + 700000 }),
    bootstrapOwner: async () => "10000000-0000-4000-8000-000000000001",
    check: async (name, fn) => {
      events.push(name);
      await fn();
    },
    signupCheck: async () => {},
    legacyCheck: async () => {},
    hostedCheck: async () => {},
    storageCheck: async () => {},
    cleanup: async () => {
      events.push("cleanup");
    },
    rollbackCheck: async (transition) => {
      await transition("switch-kova");
      await transition("restore");
      run.rollbackRestored = true;
    },
  };
  const receipt = {
    status: "complete",
    runId: run.runId,
    receipts: OWNER_CHECKS.map((check) => ({
      check,
      status: "PASS",
      kind: "DEPLOYED",
      sourceSha,
      at: new Date(now).toISOString(),
    })),
  };
  const options = {
    manifest: { ownerEmail: "fixture@example.invalid", ownerInvitation: "/tmp/unused" },
    relay: {
      open: async () => ({}),
      call: async (data) => {
        if (data) events.push("close");
        return receipt;
      },
    },
    transition: async (action) => {
      events.push(action);
    },
    realtime: async () => {},
    publishInvitation: () => {
      events.push("invite");
    },
    progress() {},
  };
  return { run, options, events, receipt };
}
test("combined session transfers receipts automatically before rollback and cleanup", async () => {
  const f = fixture();
  await executeS6(f.run, f.options);
  assert.deepEqual(
    f.run.records.map((r) => r.check),
    OWNER_CHECKS,
  );
  assert.ok(f.events.indexOf("close") < f.events.indexOf("switch-kova"));
  assert.deepEqual(f.events.slice(-3), ["switch-kova", "restore", "cleanup"]);
});
test("handoff or relay failure cannot skip fixture cleanup and pinned restoration", async () => {
  for (const failure of ["invite", "relay", "cleanup"]) {
    const f = fixture();
    if (failure === "invite")
      f.options.publishInvitation = () => {
        throw new Error("fixture");
      };
    if (failure === "relay")
      f.options.relay.call = async () => {
        throw new Error("fixture");
      };
    if (failure === "cleanup")
      f.run.cleanup = async () => {
        f.events.push("cleanup");
        throw new Error("fixture");
      };
    await assert.rejects(executeS6(f.run, f.options), AggregateError);
    assert.ok(f.events.includes("cleanup"));
    assert.ok(f.events.includes("restore"));
  }
});
test("stale, wrong-run, duplicate, source-only and future owner receipts cannot advance ledger", () => {
  for (const mutate of [
    (r) => {
      r.runId = "bad";
    },
    (r) => {
      r.receipts[0].at = new Date(0).toISOString();
    },
    (r) => {
      r.receipts[0].at = new Date(Date.now() + 60000).toISOString();
    },
    (r) => {
      r.receipts[0].kind = "SOURCE";
    },
    (r) => {
      r.receipts[0] = r.receipts[1];
    },
  ]) {
    const f = fixture();
    mutate(f.receipt);
    assert.throws(() => acceptOwnerReceipt(f.run, f.receipt));
    assert.equal(f.run.records.length, 0);
  }
});

test("failed automation blocks dependent retirement and owner ceremony but still restores", async () => {
  const f = fixture();
  f.run.check = async (name, fn) => {
    f.events.push(name);
    if (name === "legacy_mfa_bridge") f.run.records.push({ check: name, status: "FAIL" });
    else await fn();
  };
  await executeS6(f.run, f.options);
  assert.ok(!f.events.includes("public_login_and_signup"));
  assert.ok(!f.events.includes("hosted_bearer_denied_after_retirement"));
  assert.ok(!f.events.includes("invite"));
  assert.ok(!f.events.includes("switch-kova"));
  assert.deepEqual(f.events.slice(-2), ["cleanup", "restore"]);
  for (const check of [
    ...OWNER_CHECKS,
    "rollback_rehearsal",
    "hosted_bearer_denied_after_retirement",
  ])
    assert.equal(f.run.records.find((r) => r.check === check).status, "BLOCKED");
});

test("owner invitation occurs only after the automated prerequisites and signup is not rerun", async () => {
  const f = fixture();
  await executeS6(f.run, f.options);
  assert.ok(f.events.indexOf("invite") > f.events.indexOf("realtime_reauthorization"));
  assert.ok(!f.events.includes("public_login_and_signup"));
});
