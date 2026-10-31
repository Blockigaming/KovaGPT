import { principalScopedStorageKey } from "./principal-browser-storage.mjs";
import { readSidebarShortcuts } from "./sidebar-shortcuts.mjs";

export const SIDEBAR_ITEMS = Object.freeze([
  { id: "images", label: "Images", to: "/images" },
  { id: "library", label: "Library", to: "/library" },
  { id: "projects", label: "Projects", to: "/projects" },
  { id: "scheduled-tasks", label: "Scheduled tasks", to: "/scheduled-tasks" },
  { id: "apps", label: "Plugins", to: "/apps" },
  { id: "discovery", label: "Discover", to: "/discovery" },
  { id: "maps", label: "Maps", to: "/maps" },
  { id: "memory", label: "Memory", to: "/memory" },
  { id: "settings", label: "Settings", to: "/settings/appearance" },
  { id: "usage", label: "Usage", to: "/settings/usage" },
  { id: "billing", label: "Billing", to: "/settings/billing" },
  { id: "notifications", label: "Notifications", to: "/notifications" },
]);
export const DEFAULT_SIDEBAR_LAYOUT = Object.freeze({
  shortcuts: ["images", "library", "projects", "scheduled-tasks", "apps", "discovery"],
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
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const light =
    rgb.reduce(
      (sum, n, i) =>
        sum +
        (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i],
      0,
    ) > 0.35;
  return {
    "--sidebar": color,
    "--foreground": light ? "#171717" : "#fafafa",
    "--sidebar-foreground": light ? "#171717" : "#fafafa",
    "--muted-foreground": light ? "#404040" : "#d4d4d4",
    "--accent": light ? "#00000012" : "#ffffff18",
    "--border": light ? "#00000020" : "#ffffff25",
  };
}
