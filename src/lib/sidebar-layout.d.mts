import type { SidebarShortcutId } from "./sidebar-shortcuts.mjs";
export type SidebarLayout = {
  shortcuts: SidebarShortcutId[];
  width: number;
  color: string;
  searchPosition: "header" | "navigation";
  newChat: boolean;
  recentChats: boolean;
};
export const SIDEBAR_ITEMS: readonly { id: SidebarShortcutId; label: string; to: string }[];
export const DEFAULT_SIDEBAR_LAYOUT: Readonly<SidebarLayout>;
export function sidebarLayoutKey(owner: string | null | undefined): string | null;
export function clampSidebarWidth(width: unknown): number;
export function normalizeSidebarLayout(value: unknown): SidebarLayout;
export function readSidebarLayout(
  storage: Pick<Storage, "getItem"> | null,
  owner: string | null | undefined,
): SidebarLayout;
export function saveSidebarLayout(
  storage: Pick<Storage, "setItem"> | null,
  owner: string | null | undefined,
  layout: SidebarLayout,
): boolean;
export function sidebarColors(color: string): Record<string, string>;
