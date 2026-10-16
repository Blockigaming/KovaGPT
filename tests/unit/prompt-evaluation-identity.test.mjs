import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { promptEvaluationIdentity } from "../../src/lib/prompt-evaluation-identity.mjs";
test("evaluation retry identity survives reload without notes, scopes by principal and rotates only explicitly", async () => {
  const entries = new Map(),
    storage = {
      getItem: (key) => entries.get(key),
      setItem: (key, value) => entries.set(key, value),
    },
    payload = { prompt_id: "prompt", rating: 4, notes: "private evaluation" };
  const first = await promptEvaluationIdentity(
    storage,
    "owner-a",
    payload,
    () => true,
    false,
    webcrypto,
  );
  assert.equal(
    await promptEvaluationIdentity(storage, "owner-a", payload, () => true, false, webcrypto),
    first,
  );
  assert.notEqual(
    await promptEvaluationIdentity(storage, "owner-b", payload, () => true, false, webcrypto),
    first,
  );
  assert.notEqual(
    await promptEvaluationIdentity(storage, "owner-a", payload, () => true, true, webcrypto),
    first,
  );
  assert.ok(!JSON.stringify([...entries]).includes("private evaluation"));
  await assert.rejects(
    promptEvaluationIdentity(null, "owner-a", payload, () => true, false, webcrypto),
    /could not be saved/,
  );
  await assert.rejects(
    promptEvaluationIdentity(storage, "owner-a", payload, () => false, false, webcrypto),
    /context changed/,
  );
});
