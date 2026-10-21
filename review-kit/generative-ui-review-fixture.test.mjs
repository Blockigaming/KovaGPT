import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GENERATIVE_UI_REVIEW_CHAT_ID as chatId,
  GENERATIVE_UI_REVIEW_DISCLOSURE,
  GENERATIVE_UI_REVIEW_OPTION,
  GENERATIVE_UI_REVIEW_SCENARIO as scenario,
  generativeUiReviewConversation,
  generativeUiReviewWidgets,
} from "./generative-ui-review-fixture.mjs";
import {
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  FixtureRegistry,
  createConversationFixture,
  initialStorage,
  reviewConversations,
} from "./private-http-review.mjs";
import {
  REVIEW_STATE_OPTIONS,
  REVIEW_STATE_SCENARIOS,
  installReviewState,
} from "./review-state-fixtures.mjs";
import { splitGenerativeContent, validateGenerativeWidget } from "../src/lib/generative-ui.mjs";

const selection = {
  account: "free",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario,
};
const storedChats = `nova-gpt-conversations-v3:user:${REVIEW_OWNER}`;
const activeChat = `nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`;
const settings = `nova-gpt-settings-v1:${REVIEW_OWNER}`;

test("all five synthetic responses satisfy the real kova-ui contract and retain local draft labels", () => {
  const widgets = generativeUiReviewWidgets();
  assert.deepEqual(
    widgets.map(({ type }) => type),
    ["document", "code", "date", "timeline", "board"],
  );
  const conversation = generativeUiReviewConversation();
  assert.equal(conversation.messages.length, 10);
  assert.equal(new Set(conversation.messages.map(({ id }) => id)).size, 10);
  for (const [index, widget] of widgets.entries()) {
    assert.deepEqual(validateGenerativeWidget(widget), widget);
    assert.match(widget.title, /^Draft · /);
    const response = conversation.messages[index * 2 + 1];
    assert.equal(response.role, "assistant");
    assert.match(response.content, /^Synthetic local draft:/);
    const parts = splitGenerativeContent(response.content);
    assert.equal(parts.filter(({ kind }) => kind === "widget").length, 1);
    assert.deepEqual(parts.find(({ kind }) => kind === "widget").widget, widget);
    assert.ok(
      parts.some(
        ({ kind, text }) =>
          kind === "text" && text.includes("Nothing is booked, sent or executed."),
      ),
    );
  }
});

test("resets receive detached nested sample data and preserve both original conversations", () => {
  const expected = generativeUiReviewConversation();
  const first = generativeUiReviewConversation();
  first.messages[1].content = "Edited locally";
  const widgets = generativeUiReviewWidgets();
  widgets[3].items[0].title = "Edited timeline";
  widgets[4].cards[0].columnId = "exploring";
  assert.deepEqual(generativeUiReviewConversation(), expected);
  const baseline = reviewConversations();
  const reviews = reviewConversations(scenario);
  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews.slice(0, 2), baseline);
  assert.deepEqual(reviews[2], expected);
  assert.equal(reviews[2].id, chatId);
  assert.deepEqual(reviewConversations(scenario, "empty"), reviews);
  assert.equal(reviewConversations("default", "empty").length, 0);
});

test("the catalog exposes one explicit signed-in HTTP scenario without browser interception", async () => {
  const option = REVIEW_STATE_OPTIONS.find(({ id }) => id === scenario);
  assert.deepEqual(option, GENERATIVE_UI_REVIEW_OPTION);
  assert.equal(REVIEW_STATE_SCENARIOS.filter((id) => id === scenario).length, 1);
  await assert.rejects(
    installReviewState({}, scenario, "guest", { adapter: "http" }),
    /requires a synthetic/,
  );
  for (const account of option.accounts) {
    await assert.rejects(installReviewState({}, scenario, account), /ordinary private HTTP/);
    assert.equal(await installReviewState({}, scenario, account, { adapter: "http" }), option);
  }
});

test("all supported account/theme seeds select the canvas chat and preserve normal theme-only Settings", () => {
  for (const account of GENERATIVE_UI_REVIEW_OPTION.accounts) {
    for (const theme of ["dark", "light", "system"]) {
      const review = initialStorage({ ...selection, account, theme }, 1792238400000);
      const original = initialStorage(
        { ...selection, account, theme, scenario: "default" },
        1792238400000,
      );
      assert.equal(review[activeChat], chatId);
      assert.deepEqual(JSON.parse(review[storedChats]), reviewConversations(scenario));
      assert.deepEqual(JSON.parse(review[settings]), { mode: theme });
      for (const key of [storedChats, activeChat]) {
        delete review[key];
        delete original[key];
      }
      assert.deepEqual(review, original);
    }
  }
});

test("ordinary HTTP history returns the same widgets, rejects content writes, and revokes reads when inactive", async () => {
  let active = true;
  const handler = createConversationFixture(() => active, scenario);
  const registry = new FixtureRegistry();
  await registry.route("**/api/chat/history**", handler);
  const read = (query = "") =>
    registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/chat/history" + query,
      headers: { "x-kova-owner": REVIEW_OWNER },
    });
  const payloads = [];
  let page = await read();
  const epoch = page.json.epoch;
  for (;;) {
    assert.equal(page.status, 200);
    payloads.push(...page.json.records.map(({ payload }) => payload));
    if (!page.json.hasMore) break;
    page = await read(`?epoch=${epoch}&cursor=${page.json.nextCursor}`);
  }
  assert.deepEqual(payloads, reviewConversations(scenario));
  const record = handler.readRecord(chatId);
  const changed = structuredClone(record.payload);
  changed.messages[1].content = "A changed local draft must not become a successful account write.";
  const write = await registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    method: "POST",
    headers: { "x-kova-owner": REVIEW_OWNER, "content-type": "application/json" },
    body: Buffer.from(
      JSON.stringify({
        id: chatId,
        mutationId: randomUUID(),
        epoch,
        expectedRevision: record.revision,
        payload: changed,
        archived: false,
      }),
    ),
  });
  assert.equal(write.status, 503);
  assert.deepEqual(handler.readRecord(chatId).payload, generativeUiReviewConversation());
  active = false;
  assert.equal((await read()).status, 401);
  assert.equal(handler.readRecord(chatId), null);
});

test("portable review packaging includes the helper and controller disclosure explains the actual limits", () => {
  const packageSource = readFileSync(new URL("./package.mjs", import.meta.url), "utf8");
  assert.match(packageSource, /"generative-ui-review-fixture\.mjs"/);
  const adapterSource = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(
    adapterSource,
    /selected\.scenario === GENERATIVE_UI_REVIEW_SCENARIO \? `<p>\$\{htmlEscape\(GENERATIVE_UI_REVIEW_DISCLOSURE\)\}<\/p>`/,
  );
  for (const phrase of [
    "session-local drafts",
    "Code stays inert",
    "editing a widget does not save",
    "No live model",
  ])
    assert.ok(GENERATIVE_UI_REVIEW_DISCLOSURE.includes(phrase), phrase);
});
