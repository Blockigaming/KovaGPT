import assert from "node:assert/strict";
import test from "node:test";
import { parseDeveloperConversationRequest } from "../../src/lib/pricing/developer-conversation-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const parse = (method, query = "", body) =>
  parseDeveloperConversationRequest(method, new URLSearchParams(query), body);

test("conversation resource paths accept only opaque scoped identifiers", () => {
  assert.deepEqual(parse("GET"), { operation: "list", input: {} });
  assert.deepEqual(parse("GET", `id=${id}&item_id=${itemId}`), {
    operation: "get_item",
    input: { id, item_id: itemId },
  });
  assert.equal(parse("DELETE", `id=${id}`).operation, "delete");
  for (const query of ["id=../files", `id=${id}&id=${itemId}`, `owner_id=${id}`])
    assert.throws(() => parse("GET", query), /conversation_invalid/);
  assert.throws(() => parse("DELETE", `id=${id}&item_id=${itemId}`), /conversation_invalid/);
});

test("append requires a stable item ID, explicit revision and bounded plain text", () => {
  const input = {
    operation: "append",
    id,
    expected_revision: 0,
    item: { id: itemId, role: "user", content: "hello" },
  };
  assert.deepEqual(parse("POST", "", input).input.item, input.item);
  for (const patch of [
    { expected_revision: -1 },
    { expected_revision: 201 },
    { expected_revision: "0" },
    { item: { ...input.item, content: "é".repeat(4097) } },
    { item: { ...input.item, role: "tool" } },
    { item: { ...input.item, content: ["hello"] } },
    { project_id: id },
  ])
    assert.throws(() => parse("POST", "", { ...input, ...patch }), /conversation_invalid/);
});

test("create and remove reject hidden fields and preserve revision fences", () => {
  assert.deepEqual(parse("POST", "", { operation: "create", id, title: " Example " }).input, {
    id,
    title: "Example",
  });
  const remove = { operation: "remove", id, item_id: itemId, expected_revision: 1 };
  assert.deepEqual(parse("POST", "", remove).input, {
    id,
    item_id: itemId,
    expected_revision: 1,
  });
  assert.throws(() => parse("POST", "", { ...remove, force: true }), /conversation_invalid/);
  assert.throws(() => parse("POST", `id=${id}`, remove), /conversation_invalid/);
});
