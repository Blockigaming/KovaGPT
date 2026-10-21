import { principalScopedStorageKey } from "./principal-browser-storage.mjs";

export const SCHEDULED_TASK_LIST_STORAGE_BASE = "kova-scheduled-task-list";
export const PLUGIN_LIST_STORAGE_BASE = "kova-plugin-list";
export const PROJECT_LIST_STORAGE_BASE = "kova-project-list";
export const MAX_MANAGEMENT_QUERY_LENGTH = 512;
export const MAX_MANAGEMENT_PREFERENCES_LENGTH = 4096;
export const MAX_PROJECT_OPENED_ENTRIES = 5000;

function parseRecord(raw) {
  if (typeof raw !== "string" || raw.length > MAX_MANAGEMENT_PREFERENCES_LENGTH) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function queryValue(value) {
  return typeof value === "string" ? value.slice(0, MAX_MANAGEMENT_QUERY_LENGTH) : "";
}

/** Only list preferences are retained. Task records and execution state are never accepted. */
export function parseScheduledTaskListPreferences(raw) {
  const value = parseRecord(raw);
  return {
    query: queryValue(value.query),
    filter: ["active", "paused", "all"].includes(value.filter) ? value.filter : "active",
  };
}

/** The live presentation catalog supplies the allowed categories, never account/provider data. */
export function parsePluginListPreferences(raw, categories) {
  const value = parseRecord(raw);
  return {
    query: queryValue(value.query),
    category:
      typeof value.category === "string" &&
      value.category.length <= 120 &&
      categories.includes(value.category)
        ? value.category
        : "all",
    connectionFilter: value.connectionFilter === "connected" ? "connected" : "all",
  };
}

export function parseProjectListPreferences(raw) {
  const value = parseRecord(raw);
  return {
    query: queryValue(value.query),
    sort: ["opened", "name", "updated"].includes(value.sort) ? value.sort : "opened",
    scope: ["all", "owned", "shared"].includes(value.scope) ? value.scope : "all",
    archived: value.archived === true,
    view: value.view === "list" ? "list" : "grid",
  };
}

/** Only migrate the resolved owner's old key. Never adopt the ownerless global view. */
export function migrateProjectListPreferences(storage, userKey) {
  const key = principalScopedStorageKey(PROJECT_LIST_STORAGE_BASE, userKey);
  if (!key || !storage) return;
  const legacyKey = `kova-project-list:${userKey}`;
  try {
    const current = storage.getItem(key);
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) return;
    if (current === null) {
      storage.setItem(key, JSON.stringify(parseProjectListPreferences(legacy)));
    }
    // A failed write must leave the legacy value recoverable. Existing canonical values win.
    storage.removeItem(legacyKey);
  } catch {
    /* Optional storage may be denied; normal page controls remain usable. */
  }
}

/** Keep valid device-local visit times; they are separate from session list preferences. */
export function parseProjectOpenedHistory(raw) {
  if (typeof raw !== "string" || raw.length > 1024 * 1024) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([id, timestamp]) =>
            id.length > 0 &&
            id.length <= 128 &&
            !["__proto__", "constructor", "prototype"].includes(id) &&
            typeof timestamp === "number" &&
            Number.isFinite(timestamp) &&
            timestamp >= 0 &&
            timestamp <= 8.64e15,
        )
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_PROJECT_OPENED_ENTRIES),
    );
  } catch {
    return {};
  }
}
