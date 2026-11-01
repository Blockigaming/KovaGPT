export type SidebarShortcutId =
  | "images"
  | "library"
  | "projects"
  | "scheduled-tasks"
  | "apps"
  | "work"
  | "maps"
  | "usage"
  | "settings"
  | "billing"
  | "memory"
  | "notifications";
export const SIDEBAR_SHORTCUTS_KEY: string;
export const SIDEBAR_SHORTCUTS: readonly {
  readonly id: SidebarShortcutId;
  readonly label: string;
  readonly to: string;
}[];
export const DEFAULT_SIDEBAR_SHORTCUTS: readonly SidebarShortcutId[];
export function sidebarShortcutsKey(userId: string | null | undefined): string | null;
export function readSidebarShortcuts(
  storage: Pick<Storage, "getItem"> | null,
  userId: string | null | undefined,
): SidebarShortcutId[];
export function saveSidebarShortcuts(
  storage: Pick<Storage, "setItem"> | null,
  userId: string | null | undefined,
  shortcuts: readonly SidebarShortcutId[],
): boolean;
export function resetSidebarShortcuts(
  storage: Pick<Storage, "removeItem"> | null,
  userId: string | null | undefined,
): boolean;
