import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function load(available) {
  let source = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
  // Exercise the dormant transition independently of enabling a production worker.
  if (available)
    source = source.replace(
      "scheduledExecutionAvailable = false",
      "scheduledExecutionAvailable = true",
    );
  const exports = {};
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
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) =>
        ({
          zod: { z },
          "@tanstack/react-start": { createServerFn },
          "@/integrations/supabase/auth-middleware": {},
        })[name],
      console: { error() {} },
      Date,
      Error,
    },
  );
  return exports.updateScheduledTask;
}
function database(status = "failed") {
  let current = status;
  const filters = [];
  const query = {
    select: () => query,
    update: () => query,
    eq: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    in: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => ({
      data: filters.every(
        ([key, value]) =>
          key !== "status" || (Array.isArray(value) ? value.includes(current) : value === current),
      )
        ? { id: "11111111-1111-4111-8111-111111111111", status: "scheduled" }
        : null,
      error: null,
    }),
  };
  return {
    filters,
    rpc: async (name) => {
      assert.equal(name, "current_effective_plan_tier");
      return { data: "plus", error: null };
    },
    setStatus: (value) => {
      current = value;
    },
    from: (table) =>
      table === "subscriptions"
        ? {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ status: "active", current_period_end: "2099-01-01", price_id: "plus" }],
                  error: null,
                }),
              }),
            }),
          }
        : query,
  };
}
const data = { id: "11111111-1111-4111-8111-111111111111", status: "scheduled", retry: true };

test("explicit Retry atomically claims only a still-failed task", async () => {
  const update = load(true);
  const db = database();
  assert.equal(
    (await update({ data, context: { supabase: db, userId: "owner" } })).status,
    "scheduled",
  );
  assert.ok(db.filters.some(([key, value]) => key === "user_id" && value === "owner"));
  assert.ok(db.filters.some(([key, value]) => key === "status" && value === "failed"));
  for (const status of ["completed", "running", "scheduled", "paused"]) {
    const db = database(status);
    await assert.rejects(
      update({ data, context: { supabase: db, userId: "owner" } }),
      /Only a failed task/,
    );
  }
});

test("ordinary pause/resume cannot revive failed or completed rows", async () => {
  const update = load(true);
  for (const current of ["failed", "completed"]) {
    await assert.rejects(
      update({
        data: { ...data, retry: false },
        context: { supabase: database(current), userId: "owner" },
      }),
      /Completed or failed tasks/,
    );
  }
  assert.throws(
    () =>
      update({
        data: { ...data, status: "paused" },
        context: { supabase: database(), userId: "owner" },
      }),
    /Retry must schedule/,
  );
});

test("Retry remains unavailable without a deployed scheduled execution worker", async () => {
  const db = database();
  await assert.rejects(
    load(false)({ data, context: { supabase: db, userId: "owner" } }),
    /Scheduled execution is not available/,
  );
  assert.equal(db.filters.length, 0);
});
