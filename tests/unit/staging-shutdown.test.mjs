import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createAzureShutdownRunner,
  stagingShutdownMain,
  stopStagingAndVerify,
  validateStagingShutdownPlan,
  withStagingShutdown,
} from "../../scripts/azure/staging-shutdown.mjs";

function fixture() {
  const t0 = Date.parse("2026-10-20T12:00:00.000Z");
  const subscriptionId = "11111111-1111-4111-8111-111111111111";
  const targetId = `/subscriptions/${subscriptionId}/resourceGroups/rg-kovagpt-staging/providers/Microsoft.App/containerApps/ca-kovagpt-staging`;
  const plan = {
    version: 1,
    subscriptionId,
    targetId,
    attemptId: "22222222-2222-4222-8222-222222222222",
    sourceSha: "a".repeat(40),
    t0: new Date(t0).toISOString(),
    stopAt: new Date(t0 + 3_300_000).toISOString(),
    hardDeadline: new Date(t0 + 3_600_000).toISOString(),
  };
  let elapsed = 0;
  const calls = [];
  const revisions = ["ca-kovagpt-staging--old", "ca-kovagpt-staging--new"].map((name) => ({
    name,
    id: `${targetId}/revisions/${name}`,
  }));
  let respond = ({ method, url }) => {
    if (method === "post") return "";
    if (url.pathname === targetId)
      return { id: targetId, name: "ca-kovagpt-staging", runningStatus: "Stopped" };
    if (url.pathname === `${targetId}/revisions`) return { value: revisions, nextLink: null };
    if (url.pathname.endsWith("/replicas")) return { value: [], nextLink: null };
    throw new Error("unexpected test request");
  };
  const run = async (args, options) => {
    const call = {
      args,
      options,
      method: args[args.indexOf("--method") + 1],
      url: new URL(args[args.indexOf("--url") + 1]),
    };
    calls.push(call);
    const result = await respond(call);
    // Match the CLI projection, including the independent raw collection count.
    if (Array.isArray(result?.value) && !Object.hasOwn(result, "rawCount")) {
      result.rawCount = result.value.length;
    }
    return result?.ok === false
      ? result
      : { ok: true, stdout: typeof result === "string" ? result : JSON.stringify(result) };
  };
  const options = {
    run,
    now: () => t0 + elapsed,
    monotonic: () => elapsed,
    sleep: async (ms) => {
      elapsed += ms;
    },
  };
  return {
    plan,
    options,
    calls,
    revisions,
    defaultRespond: respond,
    respond: (value) => {
      respond = value;
    },
    advance: (ms) => {
      elapsed += ms;
    },
  };
}

test("shutdown refuses widened targets, out-of-range deadlines and missing cleanup reserve before commands", async () => {
  const f = fixture();
  for (const change of [
    { targetId: f.plan.targetId.replace("staging", "production") },
    { subscriptionId: "default" },
    { stopAt: "2026-10-20T12:55:00.001Z" },
    { hardDeadline: "2026-10-20T13:00:00.001Z" },
    { hardDeadline: "2026-10-20T12:59:59.999Z" },
    { t0: "2026-02-30T12:00:00.000Z" },
  ])
    await assert.rejects(
      stopStagingAndVerify({ ...f.plan, ...change }, f.options),
      /staging_shutdown_/u,
    );
  assert.equal(f.calls.length, 0);
  assert.equal(validateStagingShutdownPlan(f.plan).targetId, f.plan.targetId);
});

test("stop is real fixed-scope ARM POST; verification reads both old and new revisions twice", async () => {
  const f = fixture();
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(receipt.status, "VERIFIED_STOPPED");
  assert.equal(receipt.verificationPasses, 2);
  assert.equal(receipt.revisionCount, 2);
  assert.equal(receipt.replicaCount, 0);
  assert.equal(receipt.independentDeadlineVerified, false);
  assert.equal(receipt.activationQualified, false);
  assert.equal(f.calls[0].method, "post");
  assert.equal(f.calls[0].url.pathname, `${f.plan.targetId}/stop`);
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf("--output") + 1], "none");
  for (const call of f.calls) {
    assert.equal(call.args[0], "rest");
    assert.equal(call.url.origin, "https://management.azure.com");
    assert.equal(call.url.searchParams.get("api-version"), "2025-07-01");
    assert.equal(call.args[call.args.indexOf("--subscription") + 1], f.plan.subscriptionId);
    assert.ok(call.options.timeoutMs <= 30_000);
  }
  for (const revision of f.revisions)
    assert.equal(
      f.calls.filter((call) => call.url.pathname === `${revision.id}/replicas`).length,
      2,
    );
});

test("paginated revisions and replicas are fully counted; an old replica prevents qualification", async () => {
  const f = fixture();
  f.advance(3_590_000);
  f.respond((call) => {
    if (call.url.pathname === `${f.plan.targetId}/revisions`) {
      return call.url.searchParams.has("$skiptoken")
        ? { value: [f.revisions[1]], nextLink: null }
        : { value: [f.revisions[0]], nextLink: `${call.url.href}&$skiptoken=next` };
    }
    if (call.url.pathname === `${f.revisions[0].id}/replicas`) {
      return call.url.searchParams.has("$skiptoken")
        ? { value: [{ name: "old-replica", id: `${call.url.pathname}/old-replica` }] }
        : { value: [], nextLink: `${call.url.href}&$skiptoken=next` };
    }
    return f.defaultRespond(call);
  });
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.observedStopped, true);
  assert.equal(receipt.replicaCount, 1);
  assert.equal(receipt.failureCode, "staging_shutdown_deadline_exceeded");
});

test("a stop acknowledgment with Running app never passes", async () => {
  const f = fixture();
  f.advance(3_595_000);
  f.respond((call) =>
    call.url.pathname === f.plan.targetId
      ? { id: f.plan.targetId, name: "ca-kovagpt-staging", runningStatus: "Running" }
      : f.defaultRespond(call),
  );
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(receipt.stopAcknowledged, true);
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.observedStopped, false);
});

test("failed stop still attempts observation but cannot certify a successful request", async () => {
  const f = fixture();
  f.respond((call) =>
    call.method === "post"
      ? { ok: false, stdout: "PRIVATE provider error" }
      : f.defaultRespond(call),
  );
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(receipt.observedStopped, true);
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.failureCode, "staging_shutdown_command_failed");
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/u);
});

test("missing collections, failed reads, loops and cross-scope continuations fail closed", async () => {
  for (const badPage of [
    { value: null },
    { value: [], rawCount: 1 },
    { ok: false, stdout: "PRIVATE error" },
    { value: [], nextLink: "https://example.com/steal" },
    {
      value: [],
      nextLink: "https://management.azure.com/subscriptions/other/revisions?api-version=2025-07-01",
    },
    { value: [], nextLink: "" },
    { value: [{ name: "ca-kovagpt-staging--foreign", id: "/foreign" }] },
    "not json",
  ]) {
    const f = fixture();
    f.respond((call) =>
      call.url.pathname === `${f.plan.targetId}/revisions` ? badPage : f.defaultRespond(call),
    );
    const receipt = await stopStagingAndVerify(f.plan, f.options);
    assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
    assert.equal(receipt.replicaCount, null);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE|steal/u);
    assert.ok(f.calls.every((call) => call.url.origin === "https://management.azure.com"));
  }
  const f = fixture();
  f.respond((call) =>
    call.url.pathname === `${f.plan.targetId}/revisions`
      ? { value: [], nextLink: call.url.href }
      : f.defaultRespond(call),
  );
  assert.equal(
    (await stopStagingAndVerify(f.plan, f.options)).failureCode,
    "staging_shutdown_pagination_incomplete",
  );
});

test("a changing revision set requires a fresh stable complete scan", async () => {
  const f = fixture();
  let lists = 0;
  f.respond((call) => {
    if (call.url.pathname === `${f.plan.targetId}/revisions`)
      return { value: ++lists === 1 ? [f.revisions[0]] : f.revisions };
    return f.defaultRespond(call);
  });
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(receipt.status, "VERIFIED_STOPPED");
  assert.equal(receipt.verificationPasses, 3);
});

test("late invocation performs only bounded emergency stop, preserving original deadline", async () => {
  const f = fixture();
  f.advance(3_600_001);
  const receipt = await stopStagingAndVerify(f.plan, f.options);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "post");
  assert.equal(f.calls[0].options.timeoutMs, 30_000);
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.withinOriginalDeadline, false);
  assert.equal(receipt.hardDeadline, f.plan.hardDeadline);
});

test("backward wall clock cannot extend the monotonic shutdown budget", async () => {
  const f = fixture();
  f.advance(3_590_000);
  const initialNow = f.options.now();
  const receipt = await stopStagingAndVerify(f.plan, {
    ...f.options,
    now: () => initialNow,
    run: async (...args) => {
      f.advance(10_001);
      return f.options.run(...args);
    },
  });
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(f.calls.length, 1);
});

for (const outcome of ["success", "failure", "timeout", "cancelled"]) {
  test(`local work ${outcome} always issues stop; no callback failure text leaks`, async () => {
    const f = fixture();
    const events = new EventEmitter();
    let timer;
    const receipt = await withStagingShutdown(f.plan, {
      ...f.options,
      processSignals: events,
      schedule: (callback, delay) => {
        timer = callback;
        assert.equal(delay, 3_300_000);
        return 1;
      },
      unschedule: (id) => assert.equal(id, 1),
      work: async ({ signal }) => {
        if (outcome === "failure") throw new Error("PRIVATE action failed");
        if (["timeout", "cancelled"].includes(outcome)) {
          const aborted = new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
          if (outcome === "timeout") {
            f.advance(3_300_000);
            timer();
          } else events.emit("SIGTERM");
          await aborted;
        }
      },
    });
    assert.equal(receipt.reason, outcome);
    assert.equal(f.calls[0].method, "post");
    assert.equal(receipt.status, "VERIFIED_STOPPED");
    assert.equal(receipt.workQuiesced, true);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/u);
    assert.equal(events.listenerCount("SIGTERM"), 0);
  });
}

test("abort-ignoring work triggers stop but cannot certify completion", async () => {
  const f = fixture();
  const signal = new AbortController();
  const receipt = await withStagingShutdown(f.plan, {
    ...f.options,
    signal: signal.signal,
    processSignals: new EventEmitter(),
    work: () => {
      signal.abort();
      return new Promise(() => {});
    },
  });
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.failureCode, "staging_shutdown_work_not_quiesced");
  assert.equal(f.calls[0].method, "post");
});

test("late activation work settling after the final observation cannot certify shutdown", async () => {
  const f = fixture();
  const signal = new AbortController();
  let finishLateWork;
  let appReads = 0;
  const receipt = await withStagingShutdown(f.plan, {
    ...f.options,
    signal: signal.signal,
    processSignals: new EventEmitter(),
    work: () => {
      const pending = new Promise((resolve) => {
        finishLateWork = resolve;
      });
      signal.abort();
      return pending;
    },
    run: async (args, options) => {
      const result = await f.options.run(args, options);
      const url = new URL(args[args.indexOf("--url") + 1]);
      if (url.pathname === f.plan.targetId && ++appReads === 4) finishLateWork();
      return result;
    },
  });
  assert.equal(appReads, 4);
  assert.equal(receipt.observedStopped, true);
  assert.equal(receipt.workQuiesced, false);
  assert.equal(receipt.status, "SHUTDOWN_UNVERIFIED");
  assert.equal(receipt.failureCode, "staging_shutdown_work_not_quiesced");
});

test("production CLI adapter bounds and sanitizes failures without executing a shell", async () => {
  let recorded;
  const run = createAzureShutdownRunner({
    execute: (program, args, options, done) => {
      recorded = { program, args, options };
      done(new Error("PRIVATE token"), "PRIVATE stdout");
    },
  });
  const result = await run(["rest", "--method", "post"], { timeoutMs: 10 });
  assert.deepEqual(result, { ok: false, stdout: "" });
  assert.equal(recorded.program, "az");
  assert.equal(recorded.options.shell, undefined);
  assert.equal(recorded.options.timeout, 10);
  assert.equal(recorded.options.killSignal, "SIGKILL");
  assert.equal(recorded.options.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL, "no");
});

test("CLI has no implicit live/default mode", async () => {
  await assert.rejects(stagingShutdownMain([]), /explicit_stop_required/u);
  await assert.rejects(stagingShutdownMain(["--deploy", "/unused"]), /explicit_stop_required/u);
});
