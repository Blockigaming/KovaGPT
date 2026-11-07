import test from "node:test";
import assert from "node:assert/strict";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { createWorkHostIdleControl } from "../../src/lib/work-host-power.mjs";

function fixture({ rows = [], error = null, enabled = true } = {}) {
  let wakes = 0;
  const calls = [];
  const query = Object.fromEntries(
    ["select", "eq", "in"].map((method) => [
      method,
      (...args) => {
        calls.push([method, ...args]);
        return query;
      },
    ]),
  );
  query.limit = async (limit) => {
    calls.push(["limit", limit]);
    return { data: rows, error };
  };
  const api = loadUiModule(
    "src/lib/work-host-power.server.ts",
    {
      "@/lib/runtime-env.server": { runtimeEnv: () => undefined },
      "@/lib/ai/provider-transport.server.mjs": {
        createManagedIdentityTokenFetcher: () => async () => "unused",
      },
      "@/lib/work-host-power.mjs": {
        parseWorkHostPowerConfiguration: () => (enabled ? { resourceId: "fixed-vm" } : null),
        createWorkHostPower: () => ({
          wake: async () => {
            wakes++;
            return "starting";
          },
        }),
      },
      "@/lib/work-runner.server": { workRunnerConfiguration: () => ({ id: "fixed-runner" }) },
      "@/lib/work-execution-database.server": {
        workExecutionDatabase: () => ({
          from: (table) => {
            assert.equal(table, "work_execution_runs");
            return query;
          },
        }),
      },
      "@/integrations/supabase/client.server": {},
    },
    { Error },
  );
  return { api, calls, wakes: () => wakes };
}
test("watchdog wakes queued/running work and unresolved cleanup, but ignores sleeping saved plans", async () => {
  for (const status of ["queued", "running", "paused", "cancelled"]) {
    const f = fixture({
      rows: [
        {
          status,
          state: {
            step: status === "paused" || status === "cancelled" ? { id: "pending-step" } : null,
            outputRefs: [],
          },
        },
      ],
    });
    assert.equal((await f.api.recoverSleepingWorkHost()).status, "starting");
    assert.equal(f.wakes(), 1);
    assert.deepEqual(
      f.calls.find(([method]) => method === "eq"),
      ["eq", "state->>runnerId", "fixed-runner"],
    );
  }
  const f = fixture({ rows: [{ status: "paused", state: { step: null, outputRefs: [] } }] });
  assert.equal((await f.api.recoverSleepingWorkHost()).status, "idle");
  assert.equal(f.wakes(), 0);
});
test("unavailable or truncated queue data never authorizes shutdown", async () => {
  for (const options of [{ error: {} }, { rows: null }, { rows: Array(1001).fill({}) }]) {
    const f = fixture(options);
    await assert.rejects(f.api.workHostHasPendingWork(), /queue_unconfirmed/);
    assert.equal(f.wakes(), 0);
  }
  const f = fixture({ enabled: false });
  assert.equal((await f.api.recoverSleepingWorkHost()).status, "disabled");
  assert.equal(f.calls.length, 0);
});
test("durable admission racing idle shutdown is found and woken by the next scheduler heartbeat", async () => {
  const rows = [];
  const f = fixture({ rows });
  let now = 0,
    stopped = false;
  const idle = createWorkHostIdleControl({ now: () => now });
  now = 900001;
  assert.equal(
    await idle.suspendIfIdle({
      localIdle: () => true,
      backendIdle: async () => !(await f.api.workHostHasPendingWork()),
      suspend: async () => {
        // Backend admission used its last signed heartbeat before the local fence.
        rows.push({ status: "queued", state: { step: null, outputRefs: [] } });
        stopped = true;
      },
    }),
    true,
  );
  assert.equal(stopped, true);
  assert.equal((await f.api.recoverSleepingWorkHost()).status, "starting");
  assert.equal(rows.length, 1);
  assert.equal(f.wakes(), 1);
});
