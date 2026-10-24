import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as policy from "../../src/lib/scheduled-task-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  taskId = "22222222-2222-4222-8222-222222222222";
function load({
  available = true,
  principal = owner,
  rpcError = null,
  plan = "plus",
  authenticated = true,
  accountAvailable = true,
} = {}) {
  const calls = [],
    rpcCalls = [],
    exports = {};
  const task = { id: taskId, status: "scheduled" };
  const taskQuery = () => {
    let single = false;
    const query = {
      select: () => query,
      eq: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => {
        single = true;
        return query;
      },
      abortSignal: async () => ({ data: single ? task : [task], error: null }),
    };
    return query;
  };
  const admin = {
    from: taskQuery,
    rpc: (name, args) => ({
      abortSignal: async () => {
        rpcCalls.push(name);
        if (name === "effective_user_plan_tier") return { data: plan, error: null };
        if (name === "scheduled_task_account_available")
          return { data: accountAvailable, error: null };
        calls.push({ name, args });
        return { data: { taskId }, error: rpcError };
      },
    }),
  };
  const createServerFn = () => {
    let validate = (input) => input;
    const builder = {
      middleware: () => builder,
      validator: (fn) => {
        validate = fn;
        return builder;
      },
      handler: (fn) => (args) => fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  };
  const modules = {
    zod: { z },
    "@tanstack/react-start": { createServerFn },
    "@tanstack/react-start/server": {
      getRequest: () => new Request("https://kovagpt.com/tasks", { method: "POST" }),
    },
    "@/integrations/supabase/auth-middleware": {},
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () =>
        authenticated
          ? { userId: principal, supabaseAdmin: admin }
          : new Response("Sign in required", { status: 401 }),
    },
    "@/lib/auth-security.mjs": { isCrossSiteMutation: () => false },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/scheduled-execution-readiness.server": {
      activeScheduledExecutionReadiness: async () => ({ configured: available }),
    },
    "@/lib/runtime-env.server": { runtimeEnv: () => "test-v1" },
    "@/lib/scheduled-task-policy.mjs": policy,
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (name) => modules[name], Date, Error, AbortSignal, crypto, Response },
  );
  return { update: exports.updateScheduledTask, calls, rpcCalls, api: exports };
}
const data = () => ({
  id: taskId,
  mutationId: randomUUID(),
  expectedRevision: 4,
  expectedUserId: owner,
  status: "scheduled",
  retry: true,
});
test("retry dispatches the exact revision and mutation identity to atomic service-only admission", async () => {
  const { update, calls } = load(),
    input = data();
  assert.equal((await update({ data: input, context: { userId: owner } })).status, "scheduled");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "mutate_scheduled_task");
  assert.equal(calls[0].args.p_action, "retry");
  assert.equal(calls[0].args.p_user_id, owner);
  assert.equal(calls[0].args.p_expected_revision, 4);
  assert.equal(calls[0].args.p_mutation_id, input.mutationId);
});
test("unready execution and changed authenticated principals never dispatch a retry", async () => {
  for (const options of [{ available: false }, { principal: taskId }]) {
    const { update, calls } = load(options);
    await assert.rejects(update({ data: data(), context: { userId: owner } }));
    assert.equal(calls.length, 0);
  }
});
test("stale revision is definitive and retry cannot be combined with edited settings", async () => {
  const { update } = load({ rpcError: { code: "40001" } });
  await assert.rejects(update({ data: data(), context: { userId: owner } }), /changed/);
  assert.throws(
    () => update({ data: { ...data(), prompt: "New prompt" }, context: { userId: owner } }),
    /Save task changes/,
  );
  assert.throws(
    () => update({ data: { ...data(), status: "paused" }, context: { userId: owner } }),
    /Retry must schedule/,
  );
});

for (const plan of ["free", "plus", "pro"]) {
  test(`${plan} task entitlement is independent of billing and execution readiness`, async () => {
    for (const available of [false, true]) {
      const { api, rpcCalls } = load({ plan, available });
      const result = await api.isScheduledTasksEligible({
        data: { expectedUserId: owner },
        context: { userId: owner },
      });
      assert.equal(result.eligible, true);
      assert.equal(result.executionAvailable, available);
      assert.deepEqual(rpcCalls, ["scheduled_task_account_available"]);
    }
  });

  test(`${plan} can read, pause, delete and request admitted task actions`, async () => {
    const { api, calls } = load({ plan });
    const context = { userId: owner };
    const tasks = await api.listScheduledTasks({ data: { expectedUserId: owner }, context });
    assert.equal(tasks.length, 1);
    const history = await api.listScheduledTaskRuns({
      data: { expectedUserId: owner, taskId },
      context,
    });
    assert.equal(history.length, 1);
    await api.createScheduledTask({
      data: {
        expectedUserId: owner,
        id: taskId,
        mutationId: randomUUID(),
        title: "Task for any signed-in plan",
        prompt: "Review the current task context.",
        run_at: "2027-01-01T09:00:00.000Z",
      },
      context,
    });
    const { status, retry, ...mutation } = data();
    await api.updateScheduledTask({ data: { ...mutation, title: "Edited task" }, context });
    await api.updateScheduledTask({ data: { ...mutation, status: "paused" }, context });
    await api.updateScheduledTask({ data: { ...mutation, status: "scheduled" }, context });
    await api.offerScheduledTaskCopy({
      data: { ...mutation, email: "recipient@example.com" },
      context,
    });
    await api.deleteScheduledTask({ data: mutation, context });
    assert.deepEqual(
      calls.map(({ args }) => args.p_action),
      ["create", "edit", "pause", "resume", "shareCopy", "delete"],
    );
  });

  test(`${plan} cannot create, resume or retry without an operational scheduler`, async () => {
    const { api, calls } = load({ plan, available: false });
    const context = { userId: owner };
    await assert.rejects(
      api.createScheduledTask({
        data: {
          expectedUserId: owner,
          title: "Never dispatched",
          prompt: "Never executes while the runner is disabled.",
          run_at: "2027-01-01T09:00:00.000Z",
        },
        context,
      }),
      /Background execution is not ready/,
    );
    for (const retry of [false, true])
      await assert.rejects(
        api.updateScheduledTask({ data: { ...data(), retry }, context }),
        /Background execution is not ready/,
      );
    assert.equal(calls.length, 0);
  });
}

test("guest and unavailable accounts cannot access task entitlement or dispatch mutations", async () => {
  for (const options of [{ authenticated: false }, { accountAvailable: false }]) {
    const { api, calls } = load(options);
    const context = { userId: owner };
    await assert.rejects(
      api.isScheduledTasksEligible({ data: { expectedUserId: owner }, context }),
    );
    await assert.rejects(api.listScheduledTasks({ data: { expectedUserId: owner }, context }));
    await assert.rejects(api.updateScheduledTask({ data: data(), context }));
    assert.equal(calls.length, 0);
  }
});

test("database admission remains authoritative without advertising a paid-plan requirement", async () => {
  const { api } = load({
    plan: "free",
    rpcError: { code: "42501", message: "task_plan_required" },
  });
  await assert.rejects(
    api.updateScheduledTask({ data: data(), context: { userId: owner } }),
    /not available for this account in this deployment/,
  );
});

test("every Tasks endpoint rejects an old account draft even when middleware and current credentials now belong to another account", async () => {
  const { api, calls } = load({ principal: taskId });
  const read = { expectedUserId: owner };
  const inputs = {
    isScheduledTasksEligible: read,
    listScheduledTasks: read,
    listScheduledTaskOffers: read,
    listScheduledTaskConnections: read,
    createScheduledTask: {
      ...read,
      id: taskId,
      mutationId: randomUUID(),
      title: "Private old draft",
      prompt: "Private old context",
      run_at: new Date(Date.now() + 1000).toISOString(),
    },
    updateScheduledTask: data(),
    deleteScheduledTask: data(),
    offerScheduledTaskCopy: { ...data(), email: "recipient@example.com" },
    decideScheduledTaskCopy: { ...data(), offerId: taskId, decision: "accept" },
    listScheduledTaskRuns: { ...read, taskId },
    grantScheduledTaskConnection: {
      ...read,
      id: taskId,
      connectionId: taskId,
      provider: "gmail",
      generation: "old-generation",
      account: "old-subject",
      consent: true,
    },
    revokeScheduledTaskConnection: { ...read, id: taskId },
    listScheduledTaskContextOptions: { ...read, kind: "library" },
    listScheduledTaskResourceOptions: { ...read, grantId: taskId },
  };
  for (const [name, input] of Object.entries(inputs))
    await assert.rejects(
      api[name]({ data: input, context: { userId: taskId } }),
      /account changed/,
    );
  assert.equal(calls.length, 0);
});
