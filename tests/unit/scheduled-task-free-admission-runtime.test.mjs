import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../../src/lib/scheduled-execution.server.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("async function writeRunStart(");
const end = source.indexOf("async function executePrompt(", start);
assert.ok(start >= 0 && end > start, "scheduled-run admission function must exist");
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

const task = { id: "task-1", user_id: "owner-1" };
function fixture(plan, overrides = {}) {
  const calls = [];
  const admitted = { task: { ...task }, plan, event: null, connectionGrants: [], ...overrides };
  const admin = {
    rpc(name, args) {
      calls.push({ name, args });
      return { abortSignal: async () => ({ data: admitted, error: null }) };
    },
  };
  const admit = new Function(
    "admin",
    "runId",
    "scheduledFor",
    "AbortSignal",
    compiled + "\nreturn writeRunStart;",
  )(
    admin,
    () => "run-1",
    () => "2026-11-03T14:39:00Z",
    AbortSignal,
  );
  return { admit, admitted, calls };
}

test("database-authorized Free, Plus and Pro runs retain account and lease admission", async () => {
  for (const plan of ["free", "plus", "pro"]) {
    const { admit, admitted, calls } = fixture(plan);
    assert.equal(await admit(task, "worker-1"), admitted);
    assert.deepEqual(calls, [
      {
        name: "begin_scheduled_task_run",
        args: {
          p_task_id: task.id,
          p_worker_id: "worker-1",
          p_scheduled_for: "2026-11-03T14:39:00Z",
          p_run_id: "run-1",
        },
      },
    ]);
  }
});

test("scheduled-run admission rejects unsupported plans", async () => {
  for (const plan of ["enterprise", "unknown", null, undefined]) {
    const { admit } = fixture(plan);
    await assert.rejects(admit(task, "worker-1"), /scheduled_run_admission_failed/);
  }
});

test("Free admission still rejects a different task or account", async () => {
  for (const changed of [
    { ...task, id: "other-task" },
    { ...task, user_id: "other-owner" },
  ]) {
    const { admit } = fixture("free", { task: changed });
    await assert.rejects(admit(task, "worker-1"), /scheduled_run_admission_failed/);
  }
});
