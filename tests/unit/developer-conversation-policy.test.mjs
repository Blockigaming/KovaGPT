import assert from "node:assert/strict";
import test from "node:test";
import {
  developerConversationReference,
  expandDeveloperConversation,
  parseDeveloperConversationRequest,
} from "../../src/lib/pricing/developer-conversation-policy.mjs";

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

test("Responses binds a scoped stored conversation revision and appends only the new input", () => {
  const project = "33333333-3333-4333-8333-333333333333";
  const now = Date.parse("2026-11-27T00:00:00Z");
  const input = {
    model: "kova-fast",
    input: "Continue.",
    conversation: { id, revision: 1 },
  };
  const { body, reference } = developerConversationReference("responses", input);
  const saved = {
    id,
    project_id: project,
    revision: 1,
    created_at: "2026-11-26T00:00:00Z",
    expires_at: "2026-12-26T00:00:00Z",
    items: [{ id: itemId, role: "assistant", content: "Previous answer." }],
  };
  const result = expandDeveloperConversation(reference, body, saved, project, now);
  assert.deepEqual(result.body.input, [
    { role: "assistant", content: "Previous answer." },
    { role: "user", content: "Continue." },
  ]);
  assert.deepEqual(result.binding, { id, revision: 1, createdAt: saved.created_at });
  assert.equal(result.expiresAt, Date.parse(saved.expires_at));
  assert.equal(saved.items.length, 1);
  for (const patch of [
    { revision: 2 },
    { id: itemId },
    { project_id: itemId },
    { expires_at: saved.created_at },
    { created_at: "invalid" },
    { items: Array(100).fill(saved.items[0]) },
  ])
    assert.throws(
      () => expandDeveloperConversation(reference, body, { ...saved, ...patch }, project, now),
      /conversation_conflict/,
    );
  assert.throws(
    () =>
      expandDeveloperConversation(
        reference,
        body,
        { ...saved, items: [saved.items[0], saved.items[0]] },
        project,
        now,
      ),
    /conversation_invalid/,
  );
  assert.throws(() => developerConversationReference("embeddings", input), /conversation_invalid/);
  for (const patch of [
    { conversation: { id, revision: -1 } },
    { conversation: { id, revision: 1, project_id: project } },
    { input: [{ role: "user", content: "hello" }] },
  ])
    assert.throws(
      () => developerConversationReference("responses", { ...input, ...patch }),
      /conversation_invalid/,
    );
});
