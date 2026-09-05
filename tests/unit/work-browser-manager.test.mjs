import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserManager } from "../../work-runner/browser-manager.mjs";
import { canonicalWorkInput, workInputHash } from "../../src/lib/work-execution-protocol.mjs";
const ownerId = crypto.randomUUID(),
  runId = crypto.randomUUID(),
  sessionId = crypto.randomUUID();
function fixture() {
  const expiresAt = Date.now() + 290000,
    calls = [],
    checks = [];
  let retired = false,
    allowed = true,
    sequence = 1,
    network;
  const factory = {
    probe: async () => true,
    reapExpired: async () => {},
    closeOwner: async () => calls.push("purge"),
    create: async (input) => {
      network = input.onNetwork;
      calls.push("create");
      return {
        command: async (command) => {
          calls.push(command);
          return {
            sequence: command.sequence,
            mode: command.operation === "release" ? "agent" : "takeover",
            text: "bounded",
          };
        },
        close: async () => calls.push("close"),
      };
    },
  };
  const manager = createBrowserManager({
    store: { ownerRetired: async () => retired, withOwnerLock: async (_, fn) => fn() },
    factory,
    origins: ["https://browser-fixture.net"],
    authorize: async (input) => {
      checks.push(input);
      if (!allowed) throw new Error("denied");
      if (input.phase === "admit_agent") sequence++;
      return { allowed: true, expiresAt, sequence };
    },
  });
  const command = (operation, extra = {}) =>
    manager.command({
      ownerId,
      runId,
      sessionId,
      actor: "owner",
      expiresAt,
      sequence,
      operation,
      ...extra,
    });
  return {
    manager,
    calls,
    checks,
    command,
    setSequence: (n) => (sequence = n),
    revoke: () => (allowed = false),
    retire: () => (retired = true),
    get network() {
      return network;
    },
  };
}
test("owner commands consume exact sequence, cannot reopen a closed or ambiguous session", async () => {
  const f = fixture();
  await f.command("open");
  await assert.rejects(f.command("snapshot"));
  assert.equal(f.calls.filter((v) => v === "create").length, 1);
  f.setSequence(2);
  await f.command("close");
  f.setSequence(3);
  await assert.rejects(f.command("open"));
});
test("takeover hides catalog and blocks model; released browser requires exact approved input", async () => {
  const f = fixture();
  await f.command("open");
  const input = {
    ownerId,
    runId,
    epoch: 1,
    stepId: crypto.randomUUID(),
    inputHash: "a".repeat(64),
  };
  assert.deepEqual(await f.manager.catalog(input), []);
  f.setSequence(2);
  await f.command("release");
  assert.equal((await f.manager.catalog(input)).length, 1);
  const operation = { sessionId, operation: "snapshot" };
  input.approval = {
    id: crypto.randomUUID(),
    action: "browser_interact",
    status: "approved",
    expiresAt: Date.now() + 10000,
    canonicalInput: canonicalWorkInput(operation),
    inputHash: await workInputHash(operation),
  };
  const out = await f.manager.execute(input, {});
  assert.equal(out.outcome, "completed");
  assert.equal(out.result.sequence, 3);
  input.approval.canonicalInput = canonicalWorkInput({
    ...operation,
    operation: "fill",
    text: "credential",
  });
  await assert.rejects(f.manager.execute(input, {}));
});
test("current account fence and backend revocation stop all browser use before return", async () => {
  const f = fixture();
  await f.command("open");
  f.setSequence(2);
  f.revoke();
  await assert.rejects(f.command("snapshot"));
  assert.ok(f.calls.includes("close"));
  await assert.rejects(f.command("open"));
  const g = fixture();
  g.retire();
  await assert.rejects(g.command("open"));
  assert.equal(g.calls.length, 0);
});
test("browser worker cannot fetch outside an active exact actor and sequence", async () => {
  const f = fixture();
  await f.command("open");
  await assert.rejects(
    f.network({ url: "https://browser-fixture.net/" }, { actor: "owner", sequence: 1 }),
  );
  await f.manager.closeOwner(ownerId);
  assert.equal(f.calls.at(-1), "purge");
});
