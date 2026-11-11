import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationDismissalKey,
  noticeIsDismissed,
  rememberNoticeDismissal,
} from "../../src/lib/notification-dismissal-policy.mjs";

test("dismissals are account and campaign scoped", () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const state = {
    accountId: "user-1",
    id: "whats_new",
    campaignId: "v2026-11",
    group: "announcements",
  };
  assert.equal(noticeIsDismissed(storage, state), false);
  assert.equal(rememberNoticeDismissal(storage, state), true);
  assert.equal(noticeIsDismissed(storage, state), true);
  assert.equal(noticeIsDismissed(storage, { ...state, accountId: "user-2" }), false);
  assert.equal(noticeIsDismissed(storage, { ...state, campaignId: "v2026-12" }), false);
});
test("operation and security alerts are never muted by marketing-dismissal state", () => {
  assert.equal(
    notificationDismissalKey({ accountId: "a", id: "upload_failed", group: "files" }),
    null,
  );
  assert.equal(
    notificationDismissalKey({ accountId: "a", id: "session_expired", group: "security" }),
    null,
  );
});
test("blocked storage and malformed IDs fail safely", () => {
  const storage = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  const state = { accountId: "a", id: "whats_new", group: "announcements" };
  assert.equal(noticeIsDismissed(storage, state), false);
  assert.equal(rememberNoticeDismissal(storage, state), false);
  assert.equal(notificationDismissalKey({ ...state, accountId: "bad/id" }), null);
});
