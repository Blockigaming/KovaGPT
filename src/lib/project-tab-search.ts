export const PROJECT_TABS = [
  "overview",
  "chats",
  "files",
  "images",
  "instructions",
  "notes",
  "tasks",
  "memory",
  "members",
  "collaboration",
  "settings",
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export function projectTab(value: unknown): ProjectTab {
  return typeof value === "string" && (PROJECT_TABS as readonly string[]).includes(value)
    ? (value as ProjectTab)
    : "overview";
}
export function projectTabSearch(
  search: Record<string, unknown>,
): Record<string, unknown> & { tab?: ProjectTab } {
  const { tab, ...rest } = search;
  return { ...rest, ...(tab === undefined ? {} : { tab: projectTab(tab) }) };
}
