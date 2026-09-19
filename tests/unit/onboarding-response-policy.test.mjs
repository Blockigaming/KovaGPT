import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldOpenOnboarding } from "../../src/lib/onboarding-response-policy.mjs";

test("onboarding: a confirmed absent record still starts setup", () => {
  assert.equal(shouldOpenOnboarding(null), true);
});

test("onboarding: only the explicit incomplete flag starts an existing record", () => {
  const record = {
    primary_use: "work",
    response_style: "balanced",
    completed: false,
    completed_at: null,
  };
  assert.equal(shouldOpenOnboarding(record), true);
  assert.equal(shouldOpenOnboarding({ ...record, completed: true }), false);
  assert.equal(record.completed, false);
});

test("onboarding: failed or malformed lookups never open a competing modal", () => {
  for (const record of [
    undefined,
    false,
    0,
    "",
    "false",
    [],
    {},
    { error: "Authentication is temporarily unavailable." },
    { completed: undefined },
    { completed: null },
    { completed: 0 },
    { completed: "false" },
    { completed: false, error: "lookup_failed" },
    Object.create({ completed: false }),
    Response.json({ error: "unavailable" }, { status: 503 }),
  ]) {
    assert.equal(shouldOpenOnboarding(record), false);
  }
});

test("onboarding: the component validates results and preserves stale-owner cancellation", () => {
  const source = readFileSync(
    new URL("../../src/components/OnboardingDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{ shouldOpenOnboarding \} from "@\/lib\/onboarding-response-policy\.mjs"/u,
  );
  assert.match(
    source,
    /const row = await fetchOnboarding\(\);\s*if \(!cancelled && shouldOpenOnboarding\(row\)\) setOpen\(true\)/u,
  );
  assert.match(source, /return \(\) => \{\s*cancelled = true;/u);
  assert.doesNotMatch(source, /!row \|\| !row\.completed/u);
});

// Execute the actual GET declaration with only its auth/DB dependencies mocked.
function onboardingLookup(databaseResult) {
  const source = readFileSync(
    new URL("../../src/lib/onboarding.functions.ts", import.meta.url),
    "utf8",
  );
  const declaration = source
    .slice(
      source.indexOf("export const getOnboarding"),
      source.indexOf("export const saveOnboarding"),
    )
    .replace("export const", "const");
  const auth = {};
  const handler = new Function(
    "createServerFn",
    "requireSupabaseAuth",
    `${declaration}; return getOnboarding;`,
  )((options) => {
    assert.deepEqual(options, { method: "GET" });
    return {
      middleware(middleware) {
        assert.deepEqual(middleware, [auth]);
        return { handler: (callback) => callback };
      },
    };
  }, auth);
  const query = {
    select(fields) {
      assert.equal(fields, "primary_use, response_style, completed, completed_at");
      return this;
    },
    eq(column, value) {
      assert.equal(column, "user_id");
      assert.equal(value, "test-owner");
      return this;
    },
    async maybeSingle() {
      return databaseResult;
    },
  };
  return handler({
    context: {
      userId: "test-owner",
      supabase: {
        from(table) {
          assert.equal(table, "user_onboarding");
          return query;
        },
      },
    },
  });
}

test("onboarding: database lookup failures are not converted to missing records", async () => {
  await assert.rejects(
    onboardingLookup({ data: null, error: { message: "private-database-detail" } }),
    (error) => error.message === "Onboarding preferences are temporarily unavailable.",
  );
});

test("onboarding: confirmed missing records remain distinguishable from lookup failures", async () => {
  assert.equal(await onboardingLookup({ data: null, error: null }), null);
});

test("onboarding: successful records preserve their completion and owner-scoped lookup", async () => {
  for (const completed of [false, true]) {
    const row = { primary_use: "work", response_style: "balanced", completed, completed_at: null };
    assert.deepEqual(await onboardingLookup({ data: row, error: null }), row);
  }
});
