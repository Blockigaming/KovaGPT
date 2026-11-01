import assert from "node:assert/strict";
import test from "node:test";
import { memoryHandlerFixture } from "../helpers/memory-handler-fixture.mjs";

const chatId = "22222222-2222-4222-8222-222222222222";
const conversation = {
  id: chatId,
  title: "A chat",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: Array.from({ length: 8 }, (_, i) => ({
    id: `message-${i}`,
    role: i % 2 ? "assistant" : "user",
    content: `Turn ${i}`,
  })),
};
const payload = {
  operation: "save_reviewed_memory",
  chatId,
  expectedRevision: 3,
  memoryEnabled: true,
  temporary: false,
  confirmed: true,
  text: "  Use British spelling in future chats.\nKeep my exact words.  ",
};
const request = (body = payload, owner = "owner") =>
  new Request("https://kova.invalid/api/memory", {
    method: "POST",
    headers: { "X-Kova-Owner": owner },
    body: JSON.stringify(body),
  });
function setup(options = {}) {
  const queried = [];
  const row = {
    owner_id: "owner",
    id: chatId,
    revision: 3,
    deleted_at: null,
    payload: conversation,
    ...options.row,
  };
  const query = {
    select: (...args) => {
      queried.push(["select", ...args]);
      return query;
    },
    eq: (...args) => {
      queried.push(["eq", ...args]);
      return query;
    },
    is: (...args) => {
      queried.push(["is", ...args]);
      return query;
    },
    maybeSingle: () => query,
    abortSignal: () =>
      Promise.resolve({ data: options.missing ? null : row, error: options.readError }),
  };
  const userDb = {
    from: (table) => {
      queried.push(["from", table]);
      return query;
    },
  };
  const admin = {
    from: (name) => {
      assert.equal(name, "chat_memories");
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: async () => ({ data: [], error: null }),
      };
      return q;
    },
  };
  const fixture = memoryHandlerFixture({ tier: "pro", db: admin, userDb, ...options });
  return { ...fixture, queried };
}

test("explicit save persists only exact reviewed text, owned history count, and the captured privacy epoch", async () => {
  const fixture = setup();
  const response = await fixture.handlers.POST({ request: request() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, saved: true, chatId });
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ["epoch", "persist"],
  );
  const [, , epoch, row] = fixture.calls[1];
  assert.equal(epoch, 7);
  assert.equal(row.summary, payload.text);
  assert.equal(row.message_count, 8);
  assert.equal(row.user_id, "owner");
  assert.equal(row.chat_id, chatId);
  assert.deepEqual(fixture.queried, [
    ["from", "chat_history_records"],
    ["select", "owner_id,id,payload,revision,deleted_at"],
    ["eq", "owner_id", "owner"],
    ["eq", "id", chatId],
    ["is", "deleted_at", null],
  ]);
});

for (const change of [
  { confirmed: false },
  { memoryEnabled: false },
  { temporary: true },
  { text: " " },
  { text: "x".repeat(1501) },
  { expectedRevision: 0 },
  { messages: conversation.messages },
  { summary: "model inferred" },
]) {
  test(`reviewed save fails closed on invalid consent or forged metadata: ${Object.keys(change)}`, async () => {
    const fixture = setup();
    const response = await fixture.handlers.POST({ request: request({ ...payload, ...change }) });
    assert.equal(response.status, 400);
    assert.equal(
      fixture.calls.some(([name]) => name === "persist"),
      false,
    );
    assert.equal(fixture.queried.length, 0);
  });
}
for (const options of [
  { missing: true },
  { row: { owner_id: "other" } },
  { row: { revision: 4 } },
  { row: { deleted_at: "2026-10-19" } },
  { row: { payload: { ...conversation, temporary: true } } },
  { row: { payload: { ...conversation, memoryStartIndex: 6 } } },
]) {
  test(`deleted, changed, short, temporary, or foreign history cannot save: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options);
    const response = await fixture.handlers.POST({ request: request() });
    assert.equal(response.status, 409);
    assert.equal(
      fixture.calls.some(([name]) => name === "persist"),
      false,
    );
  });
}
test("converted temporary content is excluded and a real bounded count is used", async () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? "assistant" : "user",
    content: i < 6 ? "temporary secret" : `eligible ${i}`,
  }));
  const fixture = setup({ row: { payload: { ...conversation, memoryStartIndex: 6, messages } } });
  const response = await fixture.handlers.POST({ request: request() });
  assert.equal(response.status, 200);
  const row = fixture.calls.find(([name]) => name === "persist")[3];
  assert.equal(row.message_count, 30);
  assert.equal(row.title, "eligible 6");
  assert.equal(JSON.stringify(row).includes("temporary secret"), false);
});
for (const options of [
  { verified: false },
  { banned: Response.json({}, { status: 403 }) },
  { feature: Response.json({}, { status: 503 }) },
]) {
  test(`tier, email, ban, and feature checks block explicit writes: ${Object.keys(options)}`, async () => {
    const fixture = setup(options);
    const response = await fixture.handlers.POST({ request: request() });
    assert.ok([403, 503].includes(response.status));
    assert.equal(
      fixture.calls.some(([name]) => name === "persist"),
      false,
    );
  });
}
test("owner header and session revalidation fence reviewed text", async () => {
  for (const owner of ["other", ""]) {
    const fixture = setup();
    assert.equal((await fixture.handlers.POST({ request: request(payload, owner) })).status, 409);
    assert.equal(fixture.queried.length, 0);
  }
  const fixture = setup({ revalidateSession: async () => false });
  assert.equal((await fixture.handlers.POST({ request: request() })).status, 401);
  assert.equal(
    fixture.calls.some(([name]) => name === "persist"),
    false,
  );
});
test("privacy epoch rejection never produces success", async () => {
  const fixture = setup({ persistError: true });
  const response = await fixture.handlers.POST({ request: request() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).saved, undefined);
});

test("Free accounts can save reviewed memory with the same ownership and privacy checks", async () => {
  const f = setup({ tier: "free" });
  assert.equal((await f.handlers.POST({ request: request() })).status, 200);
  assert.ok(f.calls.some(([name]) => name === "persist"));
});
