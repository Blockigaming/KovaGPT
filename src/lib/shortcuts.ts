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

const MODIFIER_KEYS = new Set(["Mod", "Shift", "Alt", "Ctrl"]);
const KEYBOARD_MODIFIER_KEYS = new Set(["Shift", "Control", "Meta", "Alt"]);

function normalizedShortcutKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  return key.length === 1 ? key.toUpperCase() : key;
}

function normalizeShortcutCombo(combo: string): string {
  const parts = combo.split("+");
  const key = parts.pop();
  return key ? [...parts, normalizedShortcutKey(key)].join("+") : combo;
}

function isValidShortcutCombo(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STORED_COMBO_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }

  const parts = value.split("+");
  if (parts.some((part) => !part)) return false;
  const key = parts.at(-1);
  if (!key || MODIFIER_KEYS.has(key) || KEYBOARD_MODIFIER_KEYS.has(key)) return false;
  const modifiers = parts.slice(0, -1);
  return (
    modifiers.every((modifier) => MODIFIER_KEYS.has(modifier)) &&
    new Set(modifiers).size === modifiers.length
  );
}

function isStoredShortcut(value: unknown): value is StoredShortcut {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; combo?: unknown };
  return (
    typeof candidate.id === "string" &&
    KNOWN_SHORTCUT_IDS.has(candidate.id as ShortcutId) &&
    isValidShortcutCombo(candidate.combo)
  );
}

export function shortcutComboFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): string | null {
  if (KEYBOARD_MODIFIER_KEYS.has(event.key)) return null;

  const mac = isMac();
  if (!mac && event.metaKey) return null;

  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (mac && event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(normalizedShortcutKey(event.key));
  const combo = parts.join("+");
  return isValidShortcutCombo(combo) ? combo : null;
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
    const resolved = DEFAULT_SHORTCUTS.map((shortcut) => {
      const found = saved.find((candidate) => candidate.id === shortcut.id);
      return found ? { ...shortcut, combo: normalizeShortcutCombo(found.combo) } : shortcut;
    });
    return new Set(resolved.map(({ combo }) => combo)).size === resolved.length
      ? resolved
      : DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function saveShortcuts(userKey: ShortcutUserKey, list: Shortcut[]): boolean {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  const storage = safeBrowserStorage("localStorage");
  if (!key || !principal || !storage) return false;

  const saved: StoredShortcut[] = list.map(({ id, combo }) => ({
    id,
    combo: normalizeShortcutCombo(combo),
  }));
  if (
    saved.length !== DEFAULT_SHORTCUTS.length ||
    !saved.every(isStoredShortcut) ||
    new Set(saved.map(({ id }) => id)).size !== saved.length ||
    new Set(saved.map(({ combo }) => combo)).size !== saved.length
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
  const parts = combo.split("+");
  const key = parts.at(-1)?.toLowerCase();
  const needMod = parts.includes("Mod");
  const needShift = parts.includes("Shift");
  const needAlt = parts.includes("Alt");
  const needCtrl = parts.includes("Ctrl");
  const mac = isMac();

  if (!key) return false;
  if (e.metaKey !== (mac && needMod)) return false;
  if (e.ctrlKey !== ((!mac && needMod) || needCtrl)) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;
  return normalizedShortcutKey(e.key).toLowerCase() === key;
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
