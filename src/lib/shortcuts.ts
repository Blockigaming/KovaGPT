// Keyboard shortcuts: defaults, persistence, global handler.
// Users can rebind via Settings → Keyboard shortcuts. Persists to localStorage.
import {
  browserStoragePrincipal,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export type ShortcutId =
  | "new-chat"
  | "search"
  | "open-projects"
  | "open-library"
  | "open-settings"
  | "generate-image"
  | "toggle-sidebar"
  | "focus-input";

export type Shortcut = {
  id: ShortcutId;
  label: string;
  description: string;
  // Combo like "Mod+K" - "Mod" means Meta on macOS, Ctrl elsewhere.
  combo: string;
};

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: "new-chat",
    label: "New chat",
    description: "Start a fresh conversation",
    combo: "Mod+Shift+O",
  },
  { id: "search", label: "Search chats", description: "Open chat search", combo: "Mod+K" },
  {
    id: "open-projects",
    label: "Open Projects",
    description: "Jump to Projects",
    combo: "Mod+Shift+P",
  },
  {
    id: "open-library",
    label: "Open Library",
    description: "Jump to Library",
    combo: "Mod+Shift+L",
  },
  {
    id: "open-settings",
    label: "Open Settings",
    description: "Open the Settings dialog",
    combo: "Mod+,",
  },
  {
    id: "generate-image",
    label: "Generate image",
    description: "Open image generator",
    combo: "Mod+Shift+I",
  },
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    description: "Show or hide the sidebar",
    combo: "Mod+\\",
  },
  {
    id: "focus-input",
    label: "Focus chat input",
    description: "Move cursor to the composer",
    combo: "Mod+/",
  },
];

const KEY_BASE = "kova-shortcuts";
const MAX_STORED_COMBO_LENGTH = 80;
const KNOWN_SHORTCUT_IDS = new Set<ShortcutId>(DEFAULT_SHORTCUTS.map((shortcut) => shortcut.id));
type ShortcutUserKey = string | null | undefined;
type StoredShortcut = Pick<Shortcut, "id" | "combo">;

function isStoredShortcut(value: unknown): value is StoredShortcut {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; combo?: unknown };
  return (
    typeof candidate.id === "string" &&
    KNOWN_SHORTCUT_IDS.has(candidate.id as ShortcutId) &&
    typeof candidate.combo === "string" &&
    candidate.combo.length > 0 &&
    candidate.combo.length <= MAX_STORED_COMBO_LENGTH &&
    candidate.combo === candidate.combo.trim()
  );
}

export function loadShortcuts(userKey: ShortcutUserKey): Shortcut[] {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  if (!key) return DEFAULT_SHORTCUTS;
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(key);
    if (!raw) return DEFAULT_SHORTCUTS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SHORTCUTS;
    const saved = parsed.filter(isStoredShortcut);
    return DEFAULT_SHORTCUTS.map((shortcut) => {
      const found = saved.find((candidate) => candidate.id === shortcut.id);
      return found ? { ...shortcut, combo: found.combo } : shortcut;
    });
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function saveShortcuts(userKey: ShortcutUserKey, list: Shortcut[]): boolean {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  const storage = safeBrowserStorage("localStorage");
  if (!key || !principal || !storage) return false;

  const saved: StoredShortcut[] = list.map(({ id, combo }) => ({ id, combo }));
  if (
    saved.length !== DEFAULT_SHORTCUTS.length ||
    !saved.every(isStoredShortcut) ||
    new Set(saved.map(({ id }) => id)).size !== saved.length
  ) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(saved));
    window.dispatchEvent(new CustomEvent("kova-shortcuts-change", { detail: { principal } }));
    return true;
  } catch {
    return false;
  }
}

export function resetShortcuts(userKey: ShortcutUserKey): boolean {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  const storage = safeBrowserStorage("localStorage");
  if (!key || !principal || !storage) return false;
  try {
    storage.removeItem(key);
    window.dispatchEvent(new CustomEvent("kova-shortcuts-change", { detail: { principal } }));
    return true;
  } catch {
    return false;
  }
}

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

export function displayCombo(combo: string): string {
  const mac = isMac();
  return combo
    .split("+")
    .map((p) => {
      if (p === "Mod") return mac ? "⌘" : "Ctrl";
      if (p === "Shift") return mac ? "⇧" : "Shift";
      if (p === "Alt") return mac ? "⌥" : "Alt";
      if (p === "Ctrl") return mac ? "⌃" : "Ctrl";
      return p;
    })
    .join(mac ? "" : "+");
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim());
  const key = parts[parts.length - 1].toLowerCase();
  const needMod = parts.includes("Mod");
  const needShift = parts.includes("Shift");
  const needAlt = parts.includes("Alt");
  const needCtrl = parts.includes("Ctrl");
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (needMod !== mod) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;
  // "Ctrl" as an explicit part means Ctrl on both platforms.
  if (needCtrl && !e.ctrlKey) return false;
  return e.key.toLowerCase() === key;
}

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

export function installShortcutListener(
  handlers: ShortcutHandlers,
  userKey: ShortcutUserKey,
): () => void {
  if (!browserStoragePrincipal(userKey) || typeof window === "undefined") return () => {};
  const listener = (e: KeyboardEvent) => {
    // Don't hijack typing in inputs unless combo uses Mod/Shift/Alt.
    const target = e.target as HTMLElement | null;
    const inEditable =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const shortcuts = loadShortcuts(userKey);
    for (const s of shortcuts) {
      const usesMod =
        s.combo.includes("Mod") || s.combo.includes("Ctrl") || s.combo.includes("Alt");
      if (inEditable && !usesMod) continue;
      if (matches(e, s.combo)) {
        const h = handlers[s.id];
        if (h) {
          e.preventDefault();
          h();
          return;
        }
      }
    }
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}
