import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  REVIEW_OWNER,
  reviewTrashFixtures,
  reviewConversations,
  initialStorage,
  createConversationFixture,
  TRASH_REVIEW_DISCLOSURE,
} from "../../review-kit/private-http-review.mjs";
import {
  REVIEW_STATE_OPTIONS,
  installReviewState,
} from "../../review-kit/review-state-fixtures.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
const day = 86_400_000;
async function request(handler, method = "GET", body, owner = REVIEW_OWNER, query = "") {
  let response;
  await handler({
    request: () => ({
      method: () => method,
      url: () => `http://127.0.0.1:4189/api/chat/history${query}`,
      headers: () => ({ "x-kova-owner": owner }),
      postData: () => (body === undefined ? null : JSON.stringify(body)),
    }),
    fulfill: (result) => {
      response = { status: result.status ?? 200, body: result.json ?? JSON.parse(result.body) };
    },
    fallback: () => {
      throw Error("Unexpected fallback");
    },
  });
  return response;
}
async function start() {
  const handler = createConversationFixture(() => true, "chat-trash");
  const first = await request(handler);
  const payload = reviewTrashFixtures().deleted.conversation;
  return {
    handler,
    first,
    payload,
    input: {
      id: payload.id,
      payload,
      epoch: first.body.epoch,
      mutationId: randomUUID(),
      expectedRevision: 0,
      archived: false,
    },
  };
}
test("Trash scenario is signed-in only and targets actual privacy settings", async () => {
  const option = REVIEW_STATE_OPTIONS.find((item) => item.id === "chat-trash");
  assert.equal(option.path, "/settings/privacy");
  assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
  assert.equal(
    (await installReviewState({}, "chat-trash", "free", { adapter: "http" })).id,
    "chat-trash",
  );
  await assert.rejects(installReviewState({}, "chat-trash", "guest", { adapter: "http" }));
  await assert.rejects(installReviewState({}, "chat-trash", "free"));
});
test("synthetic seed has deleted, soon, expired and already-restored payloads with preserved draft", () => {
  const now = Date.now();
  const fixture = reviewTrashFixtures(now);
  const values = initialStorage({ account: "free", theme: "dark", scenario: "chat-trash" }, now);
  const stored = JSON.parse(values[`kova-chat-trash-v1:user:${REVIEW_OWNER}`]);
  assert.equal(stored.retentionMs, 30 * day);
  assert.equal(stored.entries.length, 3);
  assert.equal(fixture.deleted.expiresAt - fixture.deleted.deletedAt, 30 * day);
  assert.equal(fixture.expiringSoon.expiresAt - now, 3600000);
  assert.ok(fixture.expired.expiresAt < now);
  assert.ok(fixture.restored.restoredAt > fixture.restored.deletedAt);
  assert.ok(
    reviewConversations("chat-trash").some((chat) => chat.id === fixture.restored.conversation.id),
  );
  for (const entry of stored.entries)
    assert.deepEqual(normalizeChatHistory(entry.conversation, REVIEW_OWNER), entry.conversation);
  assert.match(
    values[`kova-draft-v2:user:${REVIEW_OWNER}:${fixture.deleted.conversation.id}`],
    /preserve/,
  );
  assert.equal(
    initialStorage({ account: "guest", theme: "dark", scenario: "chat-trash" }, now)[
      `kova-chat-trash-v1:user:${REVIEW_OWNER}`
    ],
    undefined,
  );
});
test("review restore accepts only exact known original payload, revision zero and active destination", async () => {
  const f = await start();
  for (const change of [
    { payload: { ...f.payload, title: "Changed title" } },
    { payload: { ...f.payload, messages: [] } },
    { payload: { ...f.payload, injected: true } },
    { payload: null },
    { archived: true },
    { id: "unrecognized-chat", payload: { ...f.payload, id: "unrecognized-chat" } },
    { id: "review-trash-expired", payload: reviewTrashFixtures().expired.conversation },
  ])
    assert.equal(
      (await request(f.handler, "POST", { ...f.input, ...change, mutationId: randomUUID() }))
        .status,
      503,
    );
  assert.equal((await request(f.handler, "POST", { ...f.input, expectedRevision: 1 })).status, 409);
  const restored = await request(f.handler, "POST", f.input);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.revision, 1);
  assert.deepEqual(await request(f.handler, "POST", f.input), restored);
  assert.equal((await request(f.handler, "POST", { ...f.input, archived: true })).status, 409);
  const incremental = await request(
    f.handler,
    "GET",
    undefined,
    REVIEW_OWNER,
    `?epoch=${f.first.body.epoch}&cursor=${f.first.body.currentVersion}`,
  );
  assert.equal(incremental.body.records.length, 1);
  assert.deepEqual(incremental.body.records[0].payload, f.payload);
});
test("restore cannot bypass scenario, owner, epoch or arbitrary existing chat payload guards", async () => {
  const f = await start();
  assert.equal((await request(f.handler, "POST", f.input, "other-owner")).status, 401);
  assert.equal((await request(f.handler, "POST", { ...f.input, epoch: randomUUID() })).status, 409);
  const defaultHandler = createConversationFixture();
  const defaults = await request(defaultHandler);
  assert.equal(
    (await request(defaultHandler, "POST", { ...f.input, epoch: defaults.body.epoch })).status,
    503,
  );
  const existing = defaults.body.records[0];
  assert.equal(
    (
      await request(defaultHandler, "POST", {
        ...f.input,
        id: existing.id,
        payload: { ...existing.payload, messages: [] },
        expectedRevision: 1,
        epoch: defaults.body.epoch,
      })
    ).status,
    503,
  );
  assert.equal((await request(f.handler, "POST", { ...f.input, arbitrary: true })).status, 400);
});
test("other review scenarios and final copy table remain unchanged, and disclosure is external", async () => {
  assert.equal(reviewConversations().length, 2);
  assert.deepEqual(reviewConversations("chat-trash").slice(0, 2), reviewConversations());
  assert.match(
    reviewConversations("chat-copy-task")[0].messages[1].content,
    /\| Item \| Status \|/,
  );
  assert.match(TRASH_REVIEW_DISCLOSURE, /synthetic browser-local Trash/);
  assert.match(TRASH_REVIEW_DISCLOSURE, /No real chat, provider, server retention scheduler/);
  const source = await readFile("review-kit/private-http-review.mjs", "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*src\//);
  assert.match(source, /htmlEscape\(TRASH_REVIEW_DISCLOSURE\)/);
});
