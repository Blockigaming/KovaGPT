import assert from "node:assert/strict";
import test from "node:test";
import { memoryHandlerFixture } from "../helpers/memory-handler-fixture.mjs";

const chatId = "22222222-2222-4222-8222-222222222222";
const messages = Array.from({ length: 4 }, (_, i) => ({
  role: i % 2 ? "assistant" : "user",
  content: i ? `Turn ${i}` : "For this answer only, be brief",
}));
const payload = {
  chatId,
  memoryEnabled: true,
  temporary: false,
  messages,
  contextSummary: { start: 0, count: 4, digest: "a".repeat(64), messages },
};
const request = (body, method = "POST", search = "") =>
  new Request(`https://kova.invalid/api/memory${search}`, {
    method,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });

for (const contextOnly of [undefined, false, null, "true", 1]) {
  test(`legacy automatic payload cannot promote a one-time correction: ${String(contextOnly)}`, async () => {
    const fixture = memoryHandlerFixture();
    const response = await fixture.handlers.POST({ request: request({ ...payload, contextOnly }) });
    assert.equal(response.status, 409);
    assert.deepEqual(
      fixture.calls.map(([name]) => name),
      ["epoch"],
    );
  });
}

test("valid same-chat summaries keep the privacy epoch and owner while skipping cross-chat writes", async () => {
  const fixture = memoryHandlerFixture();
  const response = await fixture.handlers.POST({
    request: request({ ...payload, contextOnly: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ["epoch", "queue"],
  );
  assert.deepEqual(fixture.calls[1].slice(2, 5), ["owner", 7, chatId]);
});

for (const contextSummary of [undefined, null, {}, { ...payload.contextSummary, count: 0 }]) {
  test(`context-only writes require a valid snapshot: ${JSON.stringify(contextSummary)}`, async () => {
    const fixture = memoryHandlerFixture();
    const response = await fixture.handlers.POST({
      request: request({ ...payload, contextOnly: true, contextSummary }),
    });
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.length, 1);
  });
}

test("disabled summaries do not fall back to account memory", async () => {
  const fixture = memoryHandlerFixture({ enabled: false });
  const response = await fixture.handlers.POST({
    request: request({ ...payload, contextOnly: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ["epoch"],
  );
});

test("queue failure remains visible and never falls back to account memory", async () => {
  const fixture = memoryHandlerFixture({ queueError: true });
  const response = await fixture.handlers.POST({
    request: request({ ...payload, contextOnly: true }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ["epoch", "queue"],
  );
});

test("descriptor GET and privacy DELETE retain existing contracts", async () => {
  const fixture = memoryHandlerFixture();
  const get = await fixture.handlers.GET({
    request: request(null, "GET", `?contextChatId=${chatId}`),
  });
  assert.equal(get.status, 200);
  const del = await fixture.handlers.DELETE({
    request: request(null, "DELETE", `?chatId=${chatId}`),
  });
  assert.equal(del.status, 200);
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ["descriptor", "delete"],
  );
});
