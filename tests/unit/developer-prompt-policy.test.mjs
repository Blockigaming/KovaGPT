import assert from "node:assert/strict";
import test from "node:test";
import { parseDeveloperPromptRequest } from "../../src/lib/pricing/developer-prompt-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const definition = {
  name: "Review",
  description: "Review evidence",
  prompt: "Cite evidence.",
};
const parse = (method, query = "", body) =>
  parseDeveloperPromptRequest(method, new URLSearchParams(query), body);

test("prompt versions have bounded text only and explicit revisions", () => {
  const create = { operation: "create", id, definition };
  assert.deepEqual(parse("POST", "", create).input, { id, definition });
  assert.equal(
    parse("POST", "", { ...create, operation: "update", expected_version: 1 }).input
      .expected_version,
    1,
  );
  assert.deepEqual(parse("GET", "id=" + id + "&version=2").input, { id, version: 2 });
  assert.equal(parse("DELETE", "id=" + id).operation, "delete");
  for (const patch of [
    { definition: { ...definition, code: "exec()" } },
    { definition: { ...definition, prompt: "é".repeat(2001) } },
    { definition: { ...definition, description: "" } },
    { project_id: id },
  ])
    assert.throws(() => parse("POST", "", { ...create, ...patch }), /prompt_invalid/);
  assert.throws(() => parse("GET", "id=" + id + "&id=" + second), /prompt_invalid/);
  assert.throws(() => parse("DELETE", "id=" + id + "&version=1"), /prompt_invalid/);
});
