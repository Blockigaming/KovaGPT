import assert from "node:assert/strict";
import test from "node:test";
import {
  expandDeveloperSkills,
  parseDeveloperSkillReferences,
  parseDeveloperSkillRequest,
} from "../../src/lib/pricing/developer-skill-policy.mjs";
import { parseDeveloperAgentTurn } from "../../src/lib/pricing/developer-agent-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const definition = {
  name: "Review",
  description: "Review evidence",
  instructions: "Cite evidence.",
};
const refs = [
  { id, version: 1 },
  { id: second, version: 2 },
];
const row = (ref, instructions = definition.instructions) => ({
  ...ref,
  definition: { ...definition, instructions },
  created_at: "2026-11-26T00:00:00Z",
});
const parse = (method, query = "", body) =>
  parseDeveloperSkillRequest(method, new URLSearchParams(query), body);

test("skill versions have bounded text only and explicit revisions", () => {
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
    { definition: { ...definition, instructions: "é".repeat(2001) } },
    { definition: { ...definition, description: "" } },
    { project_id: id },
  ])
    assert.throws(() => parse("POST", "", { ...create, ...patch }), /skill_invalid/);
  assert.throws(() => parse("GET", "id=" + id + "&id=" + second), /skill_invalid/);
  assert.throws(() => parse("DELETE", "id=" + id + "&version=1"), /skill_invalid/);
});

test("agent skills accept only bounded explicit unique version references", () => {
  assert.deepEqual(parseDeveloperSkillReferences(refs), refs);
  const turn = { agent_id: id, version: 1, input: "hello", skills: refs };
  assert.deepEqual(parseDeveloperAgentTurn(turn).skills, refs);
  for (const value of [
    [],
    [refs[0], refs[0]],
    [{ id, version: 0 }],
    [{ id, version: 1, instructions: "override" }],
  ])
    assert.throws(() => parseDeveloperSkillReferences(value), /skill_invalid/);
});

test("stored versions compose deterministically without allowing unbound or oversized instructions", () => {
  const rows = refs.map((ref) => row(ref));
  const result = expandDeveloperSkills("Base.", refs, rows);
  assert.equal(
    result.instructions,
    'Base.\n\nSkill "Review":\nCite evidence.\n\nSkill "Review":\nCite evidence.',
  );
  assert.deepEqual(
    result.bindings.map((binding) => [binding.id, binding.version]),
    refs.map((ref) => [ref.id, ref.version]),
  );
  assert.throws(() => expandDeveloperSkills("Base.", refs, rows.toReversed()), /skill_conflict/);
  assert.throws(
    () => expandDeveloperSkills("Base.", refs, [{ ...rows[0], created_at: "invalid" }, rows[1]]),
    /skill_conflict/,
  );
  assert.throws(
    () =>
      expandDeveloperSkills(
        "x".repeat(7000),
        refs,
        refs.map((ref) => row(ref, "y".repeat(1000))),
      ),
    /skill_invalid/,
  );
});
