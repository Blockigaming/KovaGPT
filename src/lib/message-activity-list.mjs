import { normalizeBrowserActivity } from "./browser-activity-contract.mjs";

export function messageActivitiesFromDelta(current, delta) {
  return appendMessageActivity(current, {
    ...(typeof delta.activity_id === "string" && delta.activity_id.trim()
      ? { activityId: delta.activity_id.slice(0, 160) }
      : {}),
    tool: String(delta.tool ?? ""),
    label: String(delta.label),
    ...(delta.tool === "browser_interact"
      ? { browser: normalizeBrowserActivity(delta.browser) }
      : {}),
    status:
      delta.status === "failed" || delta.status === "canceled"
        ? delta.status
        : delta.status === "running" || delta.status === "pending"
          ? "running"
          : "done",
  });
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
