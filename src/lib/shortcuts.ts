// Keyboard shortcuts: defaults, persistence, global handler.
// Users can rebind via Settings → Keyboard shortcuts. Persists to localStorage.

export type ShortcutId =
  | "new-chat"
  | "search"
  | "open-projects"
  | "open-library"
  | "open-settings"
  | "generate-image"
  | "toggle-sidebar"
  | "focus-input"
  | "open-lens";

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
  {
    id: "open-lens",
    label: "Open Kova Lens",
    description: "Capture selected text or an idea and continue anywhere",
    combo: "Mod+Shift+K",
  },
];

const KEY = "kova-shortcuts-v1";

export function loadShortcuts(): Shortcut[] {
  if (typeof window === "undefined") return DEFAULT_SHORTCUTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SHORTCUTS;
    const saved = JSON.parse(raw) as Partial<Shortcut>[];
    return DEFAULT_SHORTCUTS.map((d) => {
      const found = saved.find((s) => s.id === d.id);
      return found?.combo ? { ...d, combo: found.combo } : d;
    });
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function saveShortcuts(list: Shortcut[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map((s) => ({ id: s.id, combo: s.combo }))));
    window.dispatchEvent(new CustomEvent("kova-shortcuts-change"));
  } catch {
    /* ignore */
  }
}

export function resetShortcuts() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("kova-shortcuts-change"));
  } catch {
    /* ignore */
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

export function installShortcutListener(handlers: ShortcutHandlers): () => void {
  const listener = (e: KeyboardEvent) => {
    // Don't hijack typing in inputs unless combo uses Mod/Shift/Alt.
    const target = e.target as HTMLElement | null;
    const inEditable =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const shortcuts = loadShortcuts();
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
