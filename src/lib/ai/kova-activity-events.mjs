/**
 * User-visible Kova activity feed contract.
 * Only server-observed tool events can be displayed as completed actions.
 * Never expose chain-of-thought or fabricate progress from model prose.
 */
const STATES = new Set(["started", "completed", "failed"]);
const TYPES = new Set(["web_search", "cloud_browser", "connection", "file_analysis", "image_generation", "scheduled_task"]);
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function validateKovaActivityEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const keys = Object.keys(event);
  if (keys.some((key) => !["id", "type", "state", "label", "domain", "detail", "timestamp"].includes(key))) return null;
  if (typeof event.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(event.id) ||
      !TYPES.has(event.type) || !STATES.has(event.state) ||
      typeof event.label !== "string" || !event.label.trim() || event.label.length > 160 ||
      (event.domain !== undefined && (typeof event.domain !== "string" || !DOMAIN.test(event.domain))) ||
      (event.detail !== undefined && (typeof event.detail !== "string" || event.detail.length > 500)) ||
      !Number.isSafeInteger(event.timestamp) || event.timestamp < 0)
    return null;
  return {
    id: event.id, type: event.type, state: event.state, label: event.label.trim(),
    ...(event.domain ? { domain: event.domain.toLowerCase() } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    timestamp: event.timestamp,
  };
}

export function kovaActivityDisplay(event) {
  const value = validateKovaActivityEvent(event);
  if (!value) return null;
  const verbs = {
    web_search: ["Searching", "Searched"],
    cloud_browser: ["Browsing", "Browsed"],
    connection: ["Connecting", "Connected"],
    file_analysis: ["Analyzing", "Analyzed"],
    image_generation: ["Generating", "Generated"],
    scheduled_task: ["Running", "Ran"],
  };
  const [active, complete] = verbs[value.type];
  return {
    ...value,
    statusText: value.state === "failed" ? "Could not complete" :
      value.state === "completed" ? complete : active,
    iconDomain: value.domain ?? null,
  };
}
