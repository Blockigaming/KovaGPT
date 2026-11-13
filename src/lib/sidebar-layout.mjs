import { readableTextColor } from "./appearance-preferences.mjs";
import { principalScopedStorageKey } from "./principal-browser-storage.mjs";
import { readSidebarShortcuts } from "./sidebar-shortcuts.mjs";

export const SIDEBAR_ITEMS = Object.freeze([
  { id: "library", label: "Library", to: "/library" },
  { id: "projects", label: "Projects", to: "/projects" },
  { id: "scheduled-tasks", label: "Scheduled tasks", to: "/scheduled-tasks" },
  { id: "apps", label: "Connections", to: "/apps" },
  { id: "health", label: "Health", to: "/apps?connection_view=health" },
  { id: "finances", label: "Finances", to: "/apps?connection_view=finances" },
  { id: "maps", label: "Maps", to: "/maps" },
  { id: "memory", label: "Memory", to: "/memory" },
  { id: "settings", label: "Settings", to: "/settings/appearance" },
  { id: "notifications", label: "Notifications", to: "/notifications" },
]);
export const DEFAULT_SIDEBAR_LAYOUT = Object.freeze({
  shortcuts: ["library", "projects", "scheduled-tasks", "apps"],
  width: 280,
  color: "default",
  searchPosition: "header",
  newChat: true,
  recentChats: true,
});
export const sidebarLayoutKey = (owner) =>
  owner ? principalScopedStorageKey("kova-sidebar-layout-v2", owner) : null;
export const clampSidebarWidth = (width) =>
  Math.round(Math.max(240, Math.min(420, Number(width) || 280)));
export function normalizeSidebarLayout(value) {
  const choices = Array.isArray(value?.shortcuts)
    ? value.shortcuts
    : DEFAULT_SIDEBAR_LAYOUT.shortcuts;
  return {
    shortcuts: [...new Set(choices.filter((id) => SIDEBAR_ITEMS.some((item) => item.id === id)))],
    width: clampSidebarWidth(value?.width),
    color: /^#[\da-f]{6}$/i.test(value?.color) ? value.color : "default",
    searchPosition: value?.searchPosition === "navigation" ? "navigation" : "header",
    newChat: value?.newChat !== false,
    recentChats: value?.recentChats !== false,
  };
}
export function readSidebarLayout(storage, owner) {
  const key = sidebarLayoutKey(owner);
  if (!key) return normalizeSidebarLayout(null);
  try {
    const raw = storage?.getItem(key);
    if (raw && raw.length < 4096) return normalizeSidebarLayout(JSON.parse(raw));
    // Preserve the account's old rail choices when upgrading its settings format.
    const legacy = storage?.getItem(principalScopedStorageKey("kova-sidebar-shortcuts-v1", owner));
    return normalizeSidebarLayout(
      legacy ? { shortcuts: readSidebarShortcuts(storage, owner) } : null,
    );
  } catch {
    return normalizeSidebarLayout(null);
  }
}
export function saveSidebarLayout(storage, owner, layout) {
  const key = sidebarLayoutKey(owner);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeSidebarLayout(layout)));
    return true;
  } catch {
    return false;
  }
}
export function sidebarColors(color) {
  if (!/^#[\da-f]{6}$/i.test(color)) return {};
  const foreground = readableTextColor(color, "#fafafa");
  const light = foreground === "#000000";
  return {
    "--sidebar": color,
    "--foreground": foreground,
    "--sidebar-foreground": foreground,
    "--muted-foreground": readableTextColor(color, light ? "#404040" : "#d4d4d4"),
    "--accent": light ? "#00000012" : "#ffffff18",
    "--border": light ? "#00000020" : "#ffffff25",
  };
}
