export const SCHEDULED_TASK_LIST_STORAGE_BASE: "kova-scheduled-task-list";
export const PLUGIN_LIST_STORAGE_BASE: "kova-plugin-list";
export const PROJECT_LIST_STORAGE_BASE: "kova-project-list";
export const MAX_MANAGEMENT_QUERY_LENGTH: number;
export const MAX_MANAGEMENT_PREFERENCES_LENGTH: number;
export const MAX_PROJECT_OPENED_ENTRIES: number;

export type ScheduledTaskListPreferences = {
  query: string;
  filter: "active" | "paused" | "all";
};
export type PluginListPreferences = {
  query: string;
  category: string;
  connectionFilter: "all" | "connected";
};
export type ProjectListPreferences = {
  query: string;
  sort: "opened" | "name" | "updated";
  scope: "all" | "owned" | "shared";
  archived: boolean;
  view: "grid" | "list";
};

export function parseScheduledTaskListPreferences(raw: unknown): ScheduledTaskListPreferences;
export function parsePluginListPreferences(
  raw: unknown,
  categories: readonly string[],
): PluginListPreferences;
export function parseProjectListPreferences(raw: unknown): ProjectListPreferences;
export function migrateProjectListPreferences(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  userKey: string | null | undefined,
): void;
export function parseProjectOpenedHistory(raw: unknown): Record<string, number>;
