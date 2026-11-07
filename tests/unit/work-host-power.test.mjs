import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkHostPower,
  createWorkHostIdleControl,
  parseWorkHostPowerConfiguration,
} from "../../src/lib/work-host-power.mjs";
import { configuredHostPower } from "../../work-runner/host-power.mjs";

const resourceId =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.Compute/virtualMachines/kovagpt-work-540-vm";
test("host power is off by default and accepts only a pinned Azure VM resource", () => {
  assert.equal(
    parseWorkHostPowerConfiguration(() => undefined),
    null,
  );
  for (const id of [
    resourceId + "/../other",
    resourceId + "?x=y",
    "https://evil.net/vm",
    resourceId.replace("Microsoft.Compute", "Other.Provider"),
  ]) {
    assert.throws(() =>
      parseWorkHostPowerConfiguration((key) => (key.endsWith("ENABLED") ? "true" : id)),
    );
  }
});
test("simultaneous wake requests share a single ARM start and never modify the VM", async () => {
  const calls = [];
  const power = createWorkHostPower({
    resourceId,
    getToken: async () => "private",
    fetcher: async (url, init) => {
      calls.push([url, init]);
      return init.method === "GET"
        ? Response.json({ statuses: [{ code: "PowerState/deallocated" }] })
        : new Response(null, { status: 202 });
    },
  });
  assert.deepEqual(await Promise.all([power.wake(), power.wake(), power.wake()]), [
    "starting",
    "starting",
    "starting",
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][0].endsWith("/start?api-version=2024-07-01"));
  assert.equal(calls[1][1].redirect, "error");
  assert.equal(calls[1][1].body, undefined);
});
test("running, starting, stopping and deallocating hosts are observed without conflicting starts", async () => {
  for (const state of ["running", "starting", "stopping", "deallocating"]) {
    let calls = 0;
    const power = createWorkHostPower({
      resourceId,
      getToken: async () => "private",
      fetcher: async () => {
        calls++;
        return Response.json({ statuses: [{ code: `PowerState/${state}` }] });
      },
    });
    assert.equal(await power.wake(), state === "deallocating" ? "stopping" : state);
    assert.equal(calls, 1);
  }
});
test("unknown states and permission failures do not request start", async () => {
  for (const response of [
    Response.json({}),
    Response.json({ statuses: [{ code: "PowerState/new" }] }),
    new Response(null, { status: 403 }),
  ]) {
    let calls = 0;
    const power = createWorkHostPower({
      resourceId,
      getToken: async () => "private",
      fetcher: async () => {
        calls++;
        return response;
      },
    });
    await assert.rejects(power.wake(), /work_host/);
    assert.equal(calls, 1);
  }
});
test("idle suspension fences admission and rejects concurrent suspension", async () => {
  let now = 0,
    localIdle = true,
    backendCalls = 0,
    stops = 0,
    answer;
  const idle = createWorkHostIdleControl({ now: () => now });
  const options = {
    localIdle: () => localIdle,
    backendIdle: async () => {
      backendCalls++;
      return true;
    },
    suspend: async () => {
      stops++;
    },
  };
  assert.equal(await idle.suspendIfIdle(options), false);
  now = 900001;
  const release = idle.enter();
  assert.equal(await idle.suspendIfIdle(options), false);
  release();
  release();
  localIdle = false;
  assert.equal(await idle.suspendIfIdle(options), false);
  localIdle = true;
  const pending = idle.suspendIfIdle({
    ...options,
    backendIdle: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  assert.equal(idle.draining, true);
  assert.throws(() => idle.enter(), /stopping/);
  assert.equal(await idle.suspendIfIdle(options), false);
  answer(true);
  assert.equal(await pending, true);
  assert.equal(stops, 1);
  assert.equal(backendCalls, 0);
});
test("readiness reads do not renew idle time; real work does", async () => {
  let now = 0;
  const idle = createWorkHostIdleControl({ now: () => now });
  const options = { localIdle: () => true, backendIdle: async () => true, suspend: async () => {} };
  now = 800000;
  idle.enter()();
  idle.touch();
  now = 900001;
  assert.equal(await idle.suspendIfIdle(options), false);
  now = 1700001;
  idle.enter()();
  assert.equal(await idle.suspendIfIdle(options), true);
});
test("queue work, failed checks and confirmed ARM rejections leave admission open", async () => {
  for (const backendIdle of [
    async () => false,
    async () => {
      throw Error("db unavailable");
    },
    async () => true,
  ]) {
    let now = 0;
    const idle = createWorkHostIdleControl({ now: () => now });
    now = 900001;
    assert.equal(
      await idle.suspendIfIdle({
        localIdle: () => true,
        backendIdle,
        suspend: async () => {
          const error = Error("ARM forbidden");
          error.confirmedRejection = true;
          throw error;
        },
      }),
      false,
    );
    assert.equal(idle.draining, false);
    idle.enter()();
  }
});
test("a lost deallocation acknowledgement keeps admission fenced until reconciliation", async () => {
  let now = 0;
  const idle = createWorkHostIdleControl({ now: () => now });
  now = 900001;
  assert.equal(
    await idle.suspendIfIdle({
      localIdle: () => true,
      backendIdle: async () => true,
      suspend: async () => {
        throw Error("connection lost after send");
      },
    }),
    false,
  );
  assert.equal(idle.draining, true);
  assert.throws(() => idle.enter(), /stopping/);
});
test("host identity token is only sent to the configured ARM VM, never a browser destination", async () => {
  const calls = [];
  const power = configuredHostPower(
    { KOVA_WORK_HOST_POWER_ENABLED: "true", KOVA_WORK_HOST_VM_RESOURCE_ID: resourceId },
    async (url, init) => {
      calls.push([url, init]);
      return url.startsWith("http://169.254.169.254/")
        ? Response.json({ access_token: "secret" })
        : new Response(null, { status: 202 });
    },
  );
  assert.equal(await power.suspend(), "stopping");
  assert.equal(calls[0][1].headers.Metadata, "true");
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(
    calls[1][0],
    `https://management.azure.com${resourceId}/deallocate?api-version=2024-07-01`,
  );
  assert.equal(calls[1][1].headers.Authorization, "Bearer secret");
});
