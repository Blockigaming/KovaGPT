import assert from "node:assert/strict";
import test from "node:test";
import {
  expandDeveloperAgentTurn,
  parseDeveloperAgentRequest,
  parseDeveloperAgentTurn,
} from "../../src/lib/pricing/developer-agent-policy.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const definition = {
  name: "Review",
  model: "kova-fast",
  instructions: "Summarize evidence.",
  max_output_tokens: 100,
};
const parse = (method, query = "", body) =>
  parseDeveloperAgentRequest(method, new URLSearchParams(query), body);
test("definition revisions and bounds", () => {
  const create = { operation: "create", id, definition };
  assert.deepEqual(parse("POST", "", create).input, { id, definition });
  const update = { ...create, operation: "update", expected_version: 1 };
  assert.equal(parse("POST", "", update).input.expected_version, 1);
  for (const patch of [
    { expected_version: 20 },
    { expected_version: "1" },
    { definition: { ...definition, tools: [] } },
    { definition: { ...definition, max_output_tokens: 8193 } },
    { definition: { ...definition, instructions: "é".repeat(4001) } },
    { owner_id: id },
  ])
    assert.throws(() => parse("POST", "", { ...update, ...patch }), /agent_invalid/);
});
test("query validation", () => {
  assert.deepEqual(parse("GET"), { operation: "list", input: {} });
  assert.deepEqual(parse("GET", "id=" + id + "&version=2").input, { id, version: 2 });
  assert.equal(parse("DELETE", "id=" + id).operation, "delete");
  for (const query of ["version=1", "id=" + id + "&version=0", "id=" + id + "&id=" + id])
    assert.throws(() => parse("GET", query), /agent_invalid/);
  assert.throws(() => parse("DELETE", "id=" + id + "&version=1"), /agent_invalid/);
});
test("turn uses exact immutable profile", () => {
  const raw = { agent_id: id, version: 1, input: "hello" };
  const turn = parseDeveloperAgentTurn(raw);
  const saved = { id, version: 1, definition };
  assert.deepEqual(expandDeveloperAgentTurn(turn, saved), {
    model: definition.model,
    instructions: definition.instructions,
    input: raw.input,
    max_output_tokens: 100,
    stream: false,
  });
  for (const extra of [{ model: "other" }, { instructions: "changed" }, { stream: true }])
    assert.throws(() => parseDeveloperAgentTurn({ ...raw, ...extra }), /agent_invalid/);
  assert.throws(() => expandDeveloperAgentTurn(turn, { ...saved, version: 2 }), /agent_conflict/);
});

test("agent sessions bind an existing conversation revision without changing the agent definition", () => {
  const raw = { agent_id: id, version: 1, input: "Continue", conversation: { id, revision: 3 } };
  const parsed = parseDeveloperAgentTurn(raw);
  assert.deepEqual(parsed.conversation, raw.conversation);
  assert.deepEqual(
    expandDeveloperAgentTurn(parsed, { id, version: 1, definition }).conversation,
    raw.conversation,
  );
  for (const conversation of [
    { id, revision: -1 },
    { id, revision: 3, owner_id: id },
    { id: "foreign", revision: 3 },
    null,
  ])
    assert.throws(() => parseDeveloperAgentTurn({ ...raw, conversation }), /agent_invalid/);
});
