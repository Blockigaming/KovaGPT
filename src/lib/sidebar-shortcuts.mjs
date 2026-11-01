import { principalScopedStorageKey } from "./principal-browser-storage.mjs";

export const SIDEBAR_SHORTCUTS_KEY = "kova-sidebar-shortcuts-v1";
export const SIDEBAR_SHORTCUTS = Object.freeze(
  [
    { id: "images", label: "Images", to: "/images" },
    { id: "library", label: "Library", to: "/library" },
    { id: "projects", label: "Projects", to: "/projects" },
    { id: "scheduled-tasks", label: "Scheduled tasks", to: "/scheduled-tasks" },
    { id: "apps", label: "Plugins", to: "/apps" },
    { id: "maps", label: "Maps", to: "/maps" },
  ].map((shortcut) => Object.freeze(shortcut)),
);
export const DEFAULT_SIDEBAR_SHORTCUTS = Object.freeze([
  "images",
  "library",
  "projects",
  "scheduled-tasks",
  "apps",
]);

export function sidebarShortcutsKey(userId) {
  // A closed desktop rail belongs to a resolved signed-in account, never a guest.
  return typeof userId === "string" && userId.length > 0
    ? principalScopedStorageKey(SIDEBAR_SHORTCUTS_KEY, userId)
    : null;
}

function validChoices(value) {
  return (
    Array.isArray(value) &&
    value.length <= SIDEBAR_SHORTCUTS.length &&
    value.every((id) => SIDEBAR_SHORTCUTS.some((shortcut) => shortcut.id === id)) &&
    new Set(value).size === value.length
  );
}

export function readSidebarShortcuts(storage, userId) {
  const key = sidebarShortcutsKey(userId);
  if (!key) return [...DEFAULT_SIDEBAR_SHORTCUTS];
  try {
    const raw = storage?.getItem(key);
    if (!raw || raw.length > 2048) return [...DEFAULT_SIDEBAR_SHORTCUTS];
    const saved = JSON.parse(raw);
    const choices =
      Array.isArray(saved?.shortcuts) && new Set(saved.shortcuts).size === saved.shortcuts.length
        ? saved.shortcuts.filter((id) => id !== "work" && id !== "discovery")
        : null;
    return saved?.version === 1 && validChoices(choices)
      ? [...choices]
      : [...DEFAULT_SIDEBAR_SHORTCUTS];
  } catch {
    return [...DEFAULT_SIDEBAR_SHORTCUTS];
  }
}

export function saveSidebarShortcuts(storage, userId, shortcuts) {
  const key = sidebarShortcutsKey(userId);
  if (!key || !storage || !validChoices(shortcuts)) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, shortcuts }));
    return true;
  } catch {
    return false;
  }
}

export function resetSidebarShortcuts(storage, userId) {
  const key = sidebarShortcutsKey(userId);
  if (!key || !storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
