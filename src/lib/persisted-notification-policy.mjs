import { NOTIFICATION_IDS } from "./notification-catalog.mjs";
const CATALOG = new Set(NOTIFICATION_IDS);
const SERVER_KIND_TO_NOTICE = {
  task_result: "task_completed",
  task_failure: "task_failed",
  project_invitation: "invitation_received",
  project_member_joined: "member_joined",
  project_role_change: "permission_changed",
  shared_chat: "invitation_received",
  connector_reauth: "connection_expired",
  deep_research_complete: "research_completed",
  security_alert: "security_check",
  file_processing: "file_processing",
  // Billing issues and usage-threshold warnings remain in the durable inbox
  // until a truthful, correctly scoped alert type is implemented. Never claim
  // a payment succeeded or a quota is exhausted from a generic warning.
};
/**
 * Only server-persisted, unread events map to user-visible notifications.
 * Unknown types stay in the notifications inbox; never invent a generic
 * "success" for an unrecognized provider status.
 */
export function persistedNoticeKind(row) {
  if (!row || typeof row !== "object" || row.readAt !== null) return null;
  const raw = typeof row.type === "string" ? row.type : "";
  const mapped = SERVER_KIND_TO_NOTICE[raw] ?? raw;
  return CATALOG.has(mapped) ? mapped : null;
}
/** Keep notification click targets inside this app; never follow untrusted redirects. */
export function safePersistedNoticeActionUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.length > 1000 ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, "https://kovagpt.com");
    if (url.origin !== "https://kovagpt.com" || !/^\/[a-z0-9_/-]*$/i.test(url.pathname))
      return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
export function pendingPersistedNotices(rows, seen, limit = 2) {
  if (!Array.isArray(rows)) return [];
  const result = [];
  for (const row of rows) {
    if (result.length >= limit) break;
    if (
      typeof row?.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(row.id) ||
      seen?.has(row.id) ||
      !persistedNoticeKind(row) ||
      (row.source !== "application" && row.source !== "agent") ||
      typeof row.title !== "string" ||
      row.title.length > 240 ||
      typeof row.preview !== "string" ||
      row.preview.length > 2000 ||
      (row.actionUrl !== null && typeof row.actionUrl !== "string")
    )
      continue;
    result.push(row);
  }
  return result;
}

/** Only presentation history is remembered locally; server read state is separate. */
export function notificationSessionSeenKey(ownerId) {
  return typeof ownerId === "string" && /^[a-z0-9_-]{8,128}$/i.test(ownerId)
    ? "kova:notice:session-seen:" + ownerId
    : null;
}
export function readSessionSeen(storage, ownerId) {
  const key = notificationSessionSeenKey(ownerId);
  if (!storage || !key) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id) => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(-100)
        : [],
    );
  } catch {
    return new Set();
  }
}
export function rememberSessionSeen(storage, ownerId, seen) {
  const key = notificationSessionSeenKey(ownerId);
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify([...seen].slice(-100)));
    return true;
  } catch {
    return false;
  }
}
