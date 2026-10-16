import assert from "node:assert/strict";
import test from "node:test";
import { loadServerFunctions } from "../helpers/server-function-harness.mjs";
const { updatePromptTemplate } = loadServerFunctions("src/lib/professional.functions.ts");
const id = "00000000-0000-4000-8000-000000000010",
  revision = "2026-10-12T00:00:00.000001Z";
const row = {
  id,
  name: "Prompt",
  category: "General",
  body: "saved",
  variables: [],
  favorite: false,
  folder: "Unfiled",
  updated_at: revision,
  created_at: revision,
  last_used_at: null,
  use_count: 0,
};
function client(result) {
  const calls = [];
  return {
    calls,
    context: {
      supabase: {
        rpc: (name, data) => ({
          abortSignal: async (signal) => {
            assert.equal(signal.aborted, false);
            calls.push({ name, data });
            return result;
          },
        }),
        from: () => {
          throw Error("No direct-write fallback allowed");
        },
      },
      userId: "actor",
    },
  };
}
test("prompt edit requires captured revision and only invokes the atomic RPC", async () => {
  const f = client({ data: row, error: null });
  await assert.rejects(updatePromptTemplate({ data: { id, body: "edit" }, context: f.context }));
  const saved = await updatePromptTemplate({
    data: { id, expectedUpdatedAt: revision, body: "edit" },
    context: f.context,
  });
  assert.equal(saved.updated_at, revision);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), {
    name: "mutate_prompt_template",
    data: {
      p_prompt_id: id,
      p_expected_updated_at: revision,
      p_changes: { body: "edit" },
      p_increment_use: false,
    },
  });
});
test("usage mutation cannot smuggle content edits and failure or malformed acknowledgement has no fallback", async () => {
  for (const result of [
    { data: null, error: { code: "PGRST202" } },
    { data: { id, updated_at: revision }, error: null },
    { data: { ...row, id: "00000000-0000-4000-8000-000000000099" }, error: null },
  ]) {
    const f = client(result);
    await assert.rejects(
      updatePromptTemplate({ data: { id, increment_use: true }, context: f.context }),
      /could not be confirmed/,
    );
    assert.equal(f.calls.length, 1);
  }
  const f = client({ data: row, error: null });
  await assert.rejects(
    updatePromptTemplate({ data: { id, increment_use: true, body: "forged" }, context: f.context }),
  );
  assert.equal(f.calls.length, 0);
  await updatePromptTemplate({ data: { id, increment_use: true }, context: f.context });
  assert.equal(f.calls[0].data.p_expected_updated_at, null);
});
