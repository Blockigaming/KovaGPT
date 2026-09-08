import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function loadFeedbackFunctions() {
  const exports = {};
  const createServerFn = () => {
    let validate = (input) => input;
    const builder = {
      middleware: () => builder,
      validator: (fn) => {
        validate = fn;
        return builder;
      },
      handler: (fn) => async (args) => fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  };
  const dependencies = {
    "node:crypto": { createHash },
    "@tanstack/react-start": { createServerFn },
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/feedback.functions.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
      Error,
    },
  );
  return exports;
}

function feedbackDatabase(initialRating = null) {
  let rating = initialRating;
  let mutations = 0;
  const filters = [];
  const query = {
    select: () => query,
    eq: (column, value) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({
      data: rating ? { rating } : null,
      error: null,
    }),
    upsert: async (value) => {
      mutations++;
      rating = value.rating;
      return { error: null };
    },
    delete: () => {
      mutations++;
      rating = null;
      return query;
    },
    then: (resolve) => resolve({ error: null }),
  };
  return {
    supabase: { from: () => query },
    filters,
    get mutations() {
      return mutations;
    },
    get rating() {
      return rating;
    },
  };
}

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("feedback reads and writes fail before database access after an account switch", async () => {
  const { getResponseFeedback, submitResponseFeedback } = loadFeedbackFunctions();
  const db = feedbackDatabase("up");
  const context = { supabase: db.supabase, userId: ownerB };

  await assert.rejects(
    getResponseFeedback({ data: { expectedOwnerId: ownerA, messageId: "message-1" }, context }),
    /account changed/,
  );
  await assert.rejects(
    submitResponseFeedback({
      data: { expectedOwnerId: ownerA, messageId: "message-1", rating: "down" },
      context,
    }),
    /account changed/,
  );
  assert.equal(db.filters.length, 0);
  assert.equal(db.mutations, 0);
});

test("feedback hydration reads the authenticated owner's durable rating", async () => {
  const { getResponseFeedback } = loadFeedbackFunctions();
  const db = feedbackDatabase("down");
  const result = await getResponseFeedback({
    data: { expectedOwnerId: ownerA, messageId: "message-1" },
    context: { supabase: db.supabase, userId: ownerA },
  });

  assert.equal(result.rating, "down");
  assert.deepEqual(db.filters[0], ["owner_id", ownerA]);
  assert.match(String(db.filters[1][1]), /^[0-9a-f]{64}$/);
});

test("feedback mutation accepts only the matching owner", async () => {
  const { submitResponseFeedback } = loadFeedbackFunctions();
  const db = feedbackDatabase();
  const context = { supabase: db.supabase, userId: ownerA };

  await submitResponseFeedback({
    data: { expectedOwnerId: ownerA, messageId: "message-1", rating: "up" },
    context,
  });
  assert.equal(db.rating, "up");

  await submitResponseFeedback({
    data: { expectedOwnerId: ownerA, messageId: "message-1", rating: null },
    context,
  });
  assert.equal(db.rating, null);
  assert.equal(db.mutations, 2);
});
