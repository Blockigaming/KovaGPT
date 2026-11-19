import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMessageActivity,
  conversationWithLiveBrowserActivity,
  messageActivitiesFromDelta,
} from "../../src/lib/message-activity-list.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";

test("streamed activity retains operation IDs and truthful pending and terminal states", () => {
  const delta = { tool: "search_web", activity_id: "site", label: "Searching", status: "pending" };
  const rows = messageActivitiesFromDelta([], delta);
  assert.equal(rows[0].status, "running");
  const completed = messageActivitiesFromDelta(rows, {
    ...delta,
    label: "Read site",
    status: "failed",
  });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "failed");
  assert.equal(completed[0].label, "Read site");
});

test("streamed browser metadata retains safe preview references and excludes arbitrary URLs", () => {
  const [row] = messageActivitiesFromDelta([], {
    tool: "browser_interact",
    label: "Read site",
    status: "done",
    browser: {
      sessionId: "demo",
      tabCount: 1,
      observedAt: 123,
      previewPath: "https://example.com/x",
    },
  });
  assert.equal(row.status, "done");
  assert.equal(row.browser.sessionId, "demo");
  assert.equal(row.browser.previewPath, undefined);
});

test("a saved-chat snapshot can still show its own live browser after losing ephemeral activity", () => {
  const observedAt = 1000;
  const expiresAt = 601_000;
  const [activity] = messageActivitiesFromDelta([], {
    activity_id: "test-open",
    tool: "browser_interact",
    label: "Opened example.com",
    status: "running",
    browser: {
      sessionId: "live-test",
      tabCount: 1,
      observedAt,
      expiresAt,
      previewPath: "/api/browser/preview/live-test",
    },
  });
  const saved = normalizeChatHistory(
    {
      id: "chat-a",
      title: "Browser test",
      mode: "instant",
      createdAt: observedAt,
      updatedAt: observedAt,
      messages: [
        { id: "reply-a", role: "assistant", content: "Example Domain", activities: [activity] },
        { id: "reply-b", role: "assistant", content: "Another reply" },
      ],
    },
    "owner-a",
  );
  assert.deepEqual(saved.messages[0].activities, []);
  const live = {
    principal: "owner-a",
    conversationId: "chat-a",
    messageId: "reply-a",
    expiresAt,
    activity,
  };
  const presentation = conversationWithLiveBrowserActivity(saved, live, "owner-a", observedAt);
  assert.deepEqual(presentation.messages[0].activities, [activity]);
  assert.equal(presentation.messages[1], saved.messages[1]);
  assert.deepEqual(saved.messages[0].activities, []);
  assert.equal(conversationWithLiveBrowserActivity(saved, live, "owner-b", observedAt), saved);
  assert.equal(conversationWithLiveBrowserActivity(saved, live, "owner-a", expiresAt), saved);
  const otherChat = { ...saved, id: "chat-b" };
  assert.equal(
    conversationWithLiveBrowserActivity(otherChat, live, "owner-a", observedAt),
    otherChat,
  );
});

const activity = (label, status = "done", activityId) => ({
  tool: "search_web",
  label,
  status,
  ...(activityId ? { activityId } : {}),
});
test("repeated website operations append instead of replacing the same tool", () => {
  let rows = appendMessageActivity([], activity("Read example.com"));
  rows = appendMessageActivity(rows, activity("Read example.org"));
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Read example.com", "Read example.org"],
  );
});
test("an operation ID updates its own row and leaves later operations in order", () => {
  let rows = appendMessageActivity([], activity("Read first site", "running", "first"));
  rows = appendMessageActivity(rows, activity("Read second site", "running", "second"));
  rows = appendMessageActivity(rows, activity("First site read", "done", "first"));
  assert.deepEqual(
    rows.map((row) => row.activityId),
    ["first", "second"],
  );
  assert.equal(rows[0].status, "done");
  assert.equal(rows[1].status, "running");
  assert.equal(appendMessageActivity(rows, activity("First site read", "done", "first")).length, 2);
});
test("legacy running and terminal labels update without losing completed history", () => {
  const prior = activity("Read previous site");
  let rows = appendMessageActivity([prior], activity("Searching next site", "running"));
  rows = appendMessageActivity(rows, activity("Next site read", "done"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0], prior);
  assert.equal(rows[1].label, "Next site read");
  rows = appendMessageActivity(rows, activity("Read third site"));
  assert.equal(rows.length, 3);
});
test("parallel legacy operations use labels rather than overwriting an unrelated step", () => {
  let rows = appendMessageActivity([], activity("Read A", "running"));
  rows = appendMessageActivity(rows, activity("Read B", "running"));
  rows = appendMessageActivity(rows, activity("Read A", "failed"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[1].status, "running");
  rows = appendMessageActivity(rows, activity("Read C", "running", "C"));
  assert.equal(rows.length, 3);
});
test("a new ID never overwrites another live call of the same tool", () => {
  const prior = activity("Read site", "running", "one");
  const rows = appendMessageActivity([prior], activity("Read site", "done", "two"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0], prior);
});
