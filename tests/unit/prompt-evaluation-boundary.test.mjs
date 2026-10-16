import test from "node:test";
import assert from "node:assert/strict";
import { loadServerFunctions } from "../helpers/server-function-harness.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("evaluation handler requires stable request ID, uses only RPC and rejects mismatched acknowledgements", async () => {
  const { evaluatePrompt } = loadServerFunctions("src/lib/professional.functions.ts");
  const calls = [];
  let row = {
    id: id(1),
    request_id: id(2),
    prompt_id: id(3),
    rating: 4,
    notes: "notes",
    created_at: "2026-10-12T00:00:00Z",
  };
  const context = {
    userId: id(9),
    supabase: {
      rpc: (name, args) => {
        calls.push({ name, args });
        return { abortSignal: async () => ({ data: row, error: null }) };
      },
    },
  };
  const data = { requestId: id(2), prompt_id: id(3), rating: 4, notes: " notes " };
  assert.equal((await evaluatePrompt({ context, data })).id, id(1));
  assert.equal(calls[0].name, "record_prompt_evaluation");
  assert.equal(calls[0].args.p_notes, "notes");
  await assert.rejects(evaluatePrompt({ context, data: { ...data, requestId: undefined } }));
  row = { ...row, request_id: id(8) };
  await assert.rejects(evaluatePrompt({ context, data }), /unconfirmed/);
});
