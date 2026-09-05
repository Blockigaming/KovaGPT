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
function load({ available = true, principal = owner, rpcError = null } = {}) {
  const calls = [],
    exports = {};
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => query,
    abortSignal: async () => ({ data: { id: taskId, status: "scheduled" }, error: null }),
  };
  const admin = {
    from: () => query,
    rpc: (name, args) => ({
      abortSignal: async () => {
        if (name === "scheduled_task_account_available") return { data: true, error: null };
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
      requireVerifiedUser: async () => ({ userId: principal, supabaseAdmin: admin }),
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
  return { update: exports.updateScheduledTask, calls, api: exports };
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
