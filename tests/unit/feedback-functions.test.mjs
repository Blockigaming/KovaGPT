import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
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
    in: (column, values) => {
      filters.push([column, values]);
      return query;
    },
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
    then: (resolve) =>
      resolve({
        data: rating ? [{ message_id: "message-1", rating }] : [],
        error: null,
      }),
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
  const { getResponseFeedbackBatch, submitResponseFeedback } = loadFeedbackFunctions();
  const db = feedbackDatabase("up");
  const context = { supabase: db.supabase, userId: ownerB };

  await assert.rejects(
    getResponseFeedbackBatch({
      data: { expectedOwnerId: ownerA, messageIds: ["message-1"] },
      context,
    }),
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
  const { getResponseFeedbackBatch } = loadFeedbackFunctions();
  const db = feedbackDatabase("down");
  const result = await getResponseFeedbackBatch({
    data: { expectedOwnerId: ownerA, messageIds: ["message-1", "message-1"] },
    context: { supabase: db.supabase, userId: ownerA },
  });

  assert.equal(result.ratings["message-1"], "down");
  assert.deepEqual(db.filters[0], ["owner_id", ownerA]);
  assert.equal(db.filters[1][0], "message_id");
  assert.deepEqual([...db.filters[1][1]], ["message-1"]);
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

test("Help survey retries update one owner-bound feedback record", async () => {
  const db = new PGlite();
  const key = "help-center-experience-v1";
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
    `);
    for (const migration of [
      "20260722130000_product_completeness_reliability.sql",
      "20260731120000_feedback_submissions_hardening.sql",
    ]) {
      await db.exec(readFileSync("supabase/migrations/" + migration, "utf8"));
    }
    await db.query("insert into auth.users(id) values ($1), ($2)", [ownerA, ownerB]);

    const clientFor = (actor) =>
      createClient("https://feedback-fixture.example.invalid", "fixture-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          async fetch(target, options) {
            const url = new URL(target);
            assert.equal(url.pathname, "/rest/v1/feedback_submissions");
            return db.transaction(async (tx) => {
              await tx.exec("set local role authenticated");
              await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
              if (options.method === "POST") {
                assert.equal(url.searchParams.get("on_conflict"), "owner_id,duplicate_key");
                const row = JSON.parse(options.body);
                await tx.query(
                  `insert into public.feedback_submissions
                     (owner_id,message_id,rating,attach_context,context_excerpt,duplicate_key)
                   values($1,$2,$3,$4,$5,$6)
                   on conflict(owner_id,duplicate_key) do update
                     set rating=excluded.rating,attach_context=excluded.attach_context,
                         context_excerpt=excluded.context_excerpt`,
                  [
                    row.owner_id,
                    row.message_id,
                    row.rating,
                    row.attach_context,
                    row.context_excerpt,
                    row.duplicate_key,
                  ],
                );
                return new Response(null, { status: 201 });
              }
              assert.equal(url.searchParams.get("owner_id"), "eq." + actor);
              assert.equal(url.searchParams.get("message_id"), "in.(" + key + ")");
              const { rows } = await tx.query(
                "select message_id,rating from public.feedback_submissions where owner_id=$1 and message_id=$2",
                [actor, key],
              );
              return Response.json(rows);
            });
          },
        },
      });
    const { getResponseFeedbackBatch, submitResponseFeedback } = loadFeedbackFunctions();
    const save = (contextExcerpt) =>
      submitResponseFeedback({
        data: { expectedOwnerId: ownerA, messageId: key, rating: "down", contextExcerpt },
        context: { userId: ownerA, supabase: clientFor(ownerA) },
      });
    const load = (actor) =>
      getResponseFeedbackBatch({
        data: { expectedOwnerId: actor, messageIds: [key] },
        context: { userId: actor, supabase: clientFor(actor) },
      });
    assert.equal((await save(undefined)).saved, true);
    const answer = "Link directly to the setting.";
    assert.equal((await save(answer)).saved, true);
    assert.equal((await save(answer)).saved, true);
    assert.equal((await load(ownerA)).ratings[key], "down");
    assert.equal((await load(ownerB)).ratings[key], undefined);
    assert.deepEqual(
      (
        await db.query(
          "select owner_id,message_id,rating,attach_context,context_excerpt from public.feedback_submissions",
        )
      ).rows,
      [
        {
          owner_id: ownerA,
          message_id: key,
          rating: "down",
          attach_context: true,
          context_excerpt: answer,
        },
      ],
    );
  } finally {
    await db.close();
  }
});
