import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/academy-state-policy.mjs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
function fixture(enabled = true) {
  let cross = false,
    result = { data: null, error: null },
    calls = 0,
    rateCalls = 0;
  const builder = () => {
    let validate;
    const b = {
      middleware: () => b,
      validator: (fn) => {
        validate = fn;
        return b;
      },
      handler: (fn) => async (arg) => fn({ ...arg, data: validate(arg.data) }),
    };
    return b;
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return this;
    },
    abortSignal() {
      return Promise.resolve(result);
    },
  };
  const context = {
    userId: A,
    supabase: {
      from() {
        calls++;
        return query;
      },
      rpc() {
        calls++;
        return query;
      },
    },
  };
  const api = loadUiModule(
    "src/lib/academy-state.functions.ts",
    {
      "@tanstack/react-start": { createServerFn: builder },
      "@tanstack/react-start/server": {
        getRequest: () => ({ signal: new AbortController().signal }),
      },
      zod: { z },
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: async () => {
          rateCalls++;
          return { allowed: true };
        },
      },
      "@/lib/auth-security.mjs": { isCrossSiteMutation: () => cross },
      "./academy-state-policy.mjs": { ...policy, ACADEMY_ACCOUNT_PERSISTENCE_ENABLED: enabled },
      "./public-academy-content": { PUBLIC_ACADEMY_PAGES: [{ slug: "writing" }] },
    },
    { AbortSignal, TextEncoder },
  );
  return {
    api,
    context,
    setResult: (v) => (result = v),
    setCross: () => (cross = true),
    get calls() {
      return calls;
    },
    get rateCalls() {
      return rateCalls;
    },
  };
}
test("paused launch rejects Academy reads and writes before storage or rate-limit mutation", async () => {
  assert.equal(policy.ACADEMY_ACCOUNT_PERSISTENCE_ENABLED, false);
  const f = fixture(policy.ACADEMY_ACCOUNT_PERSISTENCE_ENABLED);
  const data = { expectedUserId: A, topic: "writing" };
  await assert.rejects(f.api.getAcademyState({ data, context: f.context }), /paused/);
  await assert.rejects(
    f.api.saveAcademyState({
      data: {
        ...data,
        expectedRevision: 0,
        mutationId: crypto.randomUUID(),
        body: { notes: "device draft", completed: false, checked: [] },
      },
      context: f.context,
    }),
    /paused/,
  );
  assert.equal(f.calls, 0);
  assert.equal(f.rateCalls, 0);
});
test("Academy service rejects changed principal, unknown topic and cross-site writes before storage", async () => {
  const f = fixture(),
    data = {
      expectedUserId: A,
      topic: "writing",
      expectedRevision: 0,
      mutationId: crypto.randomUUID(),
      body: { notes: "private", completed: false, checked: [] },
    };
  await assert.rejects(
    f.api.getAcademyState({ data: { expectedUserId: B, topic: "writing" }, context: f.context }),
    /account changed/,
  );
  await assert.rejects(
    f.api.getAcademyState({ data: { expectedUserId: A, topic: "unknown" }, context: f.context }),
  );
  f.setCross();
  await assert.rejects(f.api.saveAcademyState({ data, context: f.context }), /Cross-site/);
  assert.equal(f.calls, 0);
});
test("Academy service does not accept missing, foreign or mismatched save acknowledgement", async () => {
  const f = fixture(),
    body = { notes: "mine", completed: false, checked: [] },
    data = {
      expectedUserId: A,
      topic: "writing",
      expectedRevision: 0,
      mutationId: crypto.randomUUID(),
      body,
    };
  for (const row of [
    null,
    { owner_id: B, topic: "writing", revision: 1, body, updated_at: "now" },
    {
      owner_id: A,
      topic: "writing",
      revision: 1,
      body: { ...body, notes: "wrong" },
      updated_at: "now",
    },
  ]) {
    f.setResult({ data: row, error: null });
    await assert.rejects(f.api.saveAcademyState({ data, context: f.context }));
  }
});
