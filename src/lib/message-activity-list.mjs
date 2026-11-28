import {
  normalizeTaskCreatedReceipt,
  normalizeTaskCreationFailureReceipt,
} from "./task-created-receipt.mjs";
import { browserActivityIsFresh, normalizeBrowserActivity } from "./browser-activity-contract.mjs";

let liveBrowserActivity = null;
let expiryTimer;
const liveBrowserListeners = new Set();

export function getLiveBrowserActivity() {
  return liveBrowserActivity;
}

export function subscribeToLiveBrowserActivity(listener) {
  liveBrowserListeners.add(listener);
  return () => liveBrowserListeners.delete(listener);
}

function publishLiveBrowserActivity(activity) {
  liveBrowserActivity = activity;
  for (const listener of liveBrowserListeners) listener();
}

export function messageActivitiesFromDelta(current, delta) {
  const receipt =
    delta.tool === "scheduled_task" &&
    delta.status === "done" &&
    normalizeTaskCreatedReceipt(delta.taskReceipt);
  const failure =
    delta.tool === "scheduled_task" &&
    delta.status === "failed" &&
    normalizeTaskCreationFailureReceipt(delta.taskFailure);
  return appendMessageActivity(current, {
    ...(typeof delta.activity_id === "string" && delta.activity_id.trim()
      ? { activityId: delta.activity_id.slice(0, 160) }
      : {}),
    tool: String(delta.tool ?? ""),
    label: String(delta.label),
    ...(delta.tool === "browser_interact"
      ? { browser: normalizeBrowserActivity(delta.browser) }
      : {}),
    ...(receipt ? { taskReceipt: receipt } : {}),
    ...(failure ? { taskFailure: failure } : {}),
    ...(typeof delta.detail === "string" && delta.detail.trim()
      ? { detail: delta.detail.trim().slice(0, 200) }
      : {}),
    ...(Number.isSafeInteger(delta.count) && delta.count >= 0 ? { count: delta.count } : {}),
    ...(Number.isSafeInteger(delta.total) && delta.total > 0 ? { total: delta.total } : {}),
    ...(Number.isSafeInteger(delta.duration_ms) && delta.duration_ms >= 0
      ? { durationMs: delta.duration_ms }
      : {}),
    ...(typeof delta.parent_id === "string" && delta.parent_id.trim()
      ? { parentId: delta.parent_id.slice(0, 160) }
      : {}),
    status: ACTIVITY_DELTA_STATUSES.has(delta.status)
      ? delta.status
      : delta.status === "running" || delta.status === "pending"
        ? "running"
        : "done",
  });
}

const ACTIVITY_DELTA_STATUSES = new Set([
  "failed",
  "canceled",
  "queued",
  "paused",
  "skipped",
  "partial",
]);
const LIVE_STATUSES = new Set(["running", "queued", "paused"]);

/**
 * Record when a live operation was first seen and, once it settles, how long it ran.
 * Times come from this client's clock only; nothing is claimed that was not observed.
 */
export function timeMessageActivities(previous = [], next = [], now = Date.now()) {
  return next.map((activity, index) => {
    const before = activity.activityId
      ? previous.find((item) => item.activityId === activity.activityId)
      : previous[index];
    const startedAt =
      before?.startedAt ?? (activity.status === "running" ? now : activity.startedAt);
    const settled = !LIVE_STATUSES.has(activity.status);
    const timed = startedAt === undefined ? activity : { ...activity, startedAt };
    return settled && startedAt !== undefined && timed.durationMs === undefined
      ? { ...timed, durationMs: Math.max(0, now - startedAt) }
      : timed;
  });
}

export function receiveMessageActivity(delta, principal, conversationId, messageId) {
  const [activity] = messageActivitiesFromDelta([], delta);
  const browser = activity.browser;
  if (
    typeof window !== "undefined" &&
    principal &&
    activity.status === "running" &&
    browser?.previewPath &&
    browserActivityIsFresh(browser)
  ) {
    const expiresAt = browser.expiresAt ?? browser.observedAt + 300_000;
    window.clearTimeout(expiryTimer);
    publishLiveBrowserActivity({ principal, conversationId, messageId, expiresAt, activity });
    expiryTimer = window.setTimeout(() => publishLiveBrowserActivity(null), expiresAt - Date.now());
  }
  return (current = []) => timeMessageActivities(current, appendMessageActivity(current, activity));
}

// Keep each operation in arrival order; only its own status updates replace a row.
export function appendMessageActivity(current, next) {
  let match = -1;
  if (next.activityId) {
    match = current.findIndex((item) => item.activityId === next.activityId);
  } else {
    // Legacy streams omit IDs. Match a live operation by label first; a terminal
    // label may differ only when there is one unambiguous live operation.
    let count = 0;
    let only = -1;
    current.forEach((item, index) => {
      if (item.activityId || item.tool !== next.tool || item.status !== "running") return;
      count++;
      only = index;
      if (item.label === next.label) match = index;
    });
    if (match < 0 && next.status !== "running" && count === 1) match = only;
  }
  if (match < 0) return [...current, next];
  return current.map((item, index) => (index === match ? { ...item, ...next } : item));
}

// Chat history deliberately strips live leases. Put a matching lease back for
// presentation without copying it to another account, chat, or message.
export function conversationWithLiveBrowserActivity(
  conversation,
  live,
  principal,
  now = Date.now(),
) {
  if (
    !conversation ||
    !live ||
    live.principal !== principal ||
    live.conversationId !== conversation.id ||
    live.expiresAt <= now
  )
    return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.role === "assistant" && message.id === live.messageId
        ? { ...message, activities: appendMessageActivity(message.activities ?? [], live.activity) }
        : message,
    ),
  };
}
