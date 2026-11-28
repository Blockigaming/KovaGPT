import assert from "node:assert/strict";
import test from "node:test";
import { parseDeveloperPlaygroundOptions } from "../../src/lib/pricing/developer-playground-options.mjs";

test("advanced options preserve supported request additions", () => {
  assert.deepEqual(parseDeveloperPlaygroundOptions(""), {});
  const input = { instructions: "Concise", tools: [], file_ids: ["fixture"] };
  assert.deepEqual(parseDeveloperPlaygroundOptions(JSON.stringify(input)), input);
});

test("advanced options cannot override protected request fields", () => {
  for (const key of ["model", "input", "stream", "store", "reasoning", "max_output_tokens"]) {
    assert.throws(() => parseDeveloperPlaygroundOptions(JSON.stringify({ [key]: true })));
  }
  for (const input of ["null", "[]", "{", '{"__proto__":{}}', "x".repeat(32769)])
    assert.throws(() => parseDeveloperPlaygroundOptions(input));
});
