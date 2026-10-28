import assert from "node:assert/strict";
import test from "node:test";
import { hasOpenAiOperatorAccess } from "../../src/lib/ai/openai-operator-access.server.mjs";

const ownerId = "11111111-1111-4111-8111-111111111111";
const caller = { userId: ownerId, supabaseAdmin: {} };
const enabled = (name) =>
  ({
    KOVA_OPENAI_OPERATOR_ACCESS_ENABLED: "true",
    KOVA_OPENAI_OPERATOR_ACCOUNT_ID: ownerId,
    KOVA_OPENAI_OPERATOR_EMAIL: "owner@example.com",
  })[name];
const owner = async () => ({
  id: ownerId,
  email: "owner@example.com",
  email_confirmed_at: "2026-10-27T00:00:00Z",
});

test("operator access requires the enabled exact account and verified owner identity", async () => {
  assert.equal(await hasOpenAiOperatorAccess(caller, enabled, owner), true);
  assert.equal(
    await hasOpenAiOperatorAccess(
      caller,
      () => undefined,
      async () => {
        throw Error("lookup should not run");
      },
    ),
    false,
  );
  assert.equal(
    await hasOpenAiOperatorAccess(
      { ...caller, userId: "22222222-2222-4222-8222-222222222222" },
      enabled,
      owner,
    ),
    false,
  );
  assert.equal(
    await hasOpenAiOperatorAccess(
      caller,
      (name) => (name === "KOVA_OPENAI_OPERATOR_ACCOUNT_ID" ? "bad" : enabled(name)),
      owner,
    ),
    false,
  );
  assert.equal(
    await hasOpenAiOperatorAccess(
      caller,
      (name) => (name === "KOVA_OPENAI_OPERATOR_EMAIL" ? "other@example.com" : enabled(name)),
      owner,
    ),
    false,
  );
  for (const changed of [
    { id: ownerId, email: "other@example.com", email_confirmed_at: "2026-10-27T00:00:00Z" },
    { id: ownerId, email: "owner@example.com", email_confirmed_at: null },
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "owner@example.com",
      email_confirmed_at: "2026-10-27T00:00:00Z",
    },
  ])
    assert.equal(await hasOpenAiOperatorAccess(caller, enabled, async () => changed), false);
  assert.equal(
    await hasOpenAiOperatorAccess(caller, enabled, async () => {
      throw Error("private database error");
    }),
    false,
  );
});
