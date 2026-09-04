import assert from "node:assert/strict";
import test from "node:test";
import {
  LockdownPolicyError,
  assertLockdownAllows,
  enforceLockdownCapability,
  lockdownEnabledFromSettings,
  lockdownErrorResponse,
  readLockdownMode,
} from "../../src/lib/lockdown-policy.mjs";

function client(result) {
  return {
    from(table) {
      assert.equal(table, "user_preferences");
      return {
        select(columns) {
          assert.equal(columns, "settings");
          return {
            eq(column, userId) {
              assert.equal(column, "user_id");
              assert.match(userId, /^[0-9a-f-]{36}$/u);
              return { maybeSingle: async () => result };
            },
          };
        },
      };
    },
  };
}

const USER_ID = "10000000-0000-4000-8000-000000000001";

test("Lockdown Mode defaults off only for a valid missing preference", async () => {
  assert.equal(lockdownEnabledFromSettings(null), false);
  assert.equal(await readLockdownMode(client({ data: null, error: null }), USER_ID), false);
  assert.equal(
    await readLockdownMode(client({ data: { settings: { lockdown_mode: false } } }), USER_ID),
    false,
  );
});

test("Lockdown Mode recognizes only the explicit boolean setting", async () => {
  assert.equal(lockdownEnabledFromSettings({ lockdown_mode: true }), true);
  assert.equal(lockdownEnabledFromSettings({ lockdown_mode: "true" }), false);
  assert.throws(
    () => lockdownEnabledFromSettings([]),
    (error) => error instanceof LockdownPolicyError && error.status === 503,
  );
});

test("policy lookup failures fail closed before network access", async () => {
  await assert.rejects(
    () => readLockdownMode(client({ data: null, error: { message: "offline" } }), USER_ID),
    (error) => error instanceof LockdownPolicyError && error.code === "lockdown_state_unavailable",
  );
  await assert.rejects(
    () => readLockdownMode(client({ data: null }), "not-a-user"),
    (error) => error instanceof LockdownPolicyError && error.status === 401,
  );
});

test("every declared network capability is blocked when Lockdown Mode is on", async () => {
  const enabled = client({ data: { settings: { lockdown_mode: true } }, error: null });
  for (const capability of [
    "live_web",
    "deep_research",
    "agent",
    "connector_read",
    "connector_write",
    "canvas_network",
    "remote_download",
  ]) {
    await assert.rejects(
      () => assertLockdownAllows(enabled, USER_ID, capability),
      (error) =>
        error instanceof LockdownPolicyError &&
        error.status === 403 &&
        error.code === `lockdown_blocked_${capability}`,
    );
  }
});

test("safe Lockdown responses distinguish blocks from policy outages", async () => {
  const blocked = lockdownErrorResponse(new LockdownPolicyError("lockdown_blocked_live_web", 403));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("cache-control"), "no-store");
  assert.equal(blocked.headers.get("retry-after"), null);

  const unavailable = lockdownErrorResponse(
    new LockdownPolicyError("lockdown_state_unavailable", 503),
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "5");
  assert.equal(lockdownErrorResponse(new Error("unrelated")), null);
});

test("route enforcement returns safe responses and permits allowed requests", async () => {
  const enabled = client({ data: { settings: { lockdown_mode: true } }, error: null });
  const disabled = client({ data: { settings: { lockdown_mode: false } }, error: null });
  const blocked = await enforceLockdownCapability(enabled, USER_ID, "connector_read");
  assert.equal(blocked?.status, 403);
  assert.equal(await enforceLockdownCapability(disabled, USER_ID, "connector_read"), null);
});
