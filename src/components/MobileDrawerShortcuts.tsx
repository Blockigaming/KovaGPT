import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Compass, MessageSquare, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import type { SidebarGlyph } from "@/components/SidebarIcons";
import type { SIDEBAR_ITEMS } from "@/lib/sidebar-layout.mjs";
import type { SidebarShortcutId } from "@/lib/sidebar-shortcuts.mjs";
import {
  isPrincipalBrowserStorageClearedEvent,
  principalScopedStorageKey,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

type Shortcut = (typeof SIDEBAR_ITEMS)[number];

const PIN_LIMIT = 2;

export function MobileDrawerShortcuts({
  owner,
  shortcuts,
  initialPins,
  icons,
  exploreOpen,
  onExploreOpenChange,
  onNavigate,
  onOpenSettings,
  isCurrent,
}: {
  owner: string;
  shortcuts: readonly Shortcut[];
  initialPins: readonly SidebarShortcutId[];
  icons: Record<SidebarShortcutId, SidebarGlyph>;
  exploreOpen: boolean;
  onExploreOpenChange: (open: boolean) => void;
  onNavigate: (destination: string) => void;
  onOpenSettings: () => void;
  isCurrent: (destination: string) => boolean;
}) {
  const key = principalScopedStorageKey("kova-mobile-shortcuts-v1", owner);
  const [preference, setPreference] = useState<{ key: string | null; ids: SidebarShortcutId[] }>();
  const [replacement, setReplacement] = useState<SidebarShortcutId | null>(null);
  const [error, setError] = useState("");
  const pinnable = shortcuts.filter(({ id }) => id !== "settings");
  const source = preference?.key === key ? preference.ids : initialPins;
  const pinned = [...new Set(source)]
    .filter((id) => pinnable.some((shortcut) => shortcut.id === id))
    .slice(0, PIN_LIMIT);
  const replacementItem = pinnable.find((item) => item.id === replacement);

  useEffect(() => {
    if (!key) return;
    const read = () => {
      try {
        const value: unknown = JSON.parse(
          safeBrowserStorage("localStorage")?.getItem(key) ?? "null",
        );
        setPreference(
          Array.isArray(value) && value.length <= PIN_LIMIT ? { key, ids: value } : undefined,
        );
      } catch {
        setPreference(undefined);
      }
    };
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    const reset = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, owner)) read();
    };
    read();
    window.addEventListener("storage", sync);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [key, owner]);

  const save = (ids: SidebarShortcutId[]) => {
    const storage = safeBrowserStorage("localStorage");
    if (!key) return;
    setPreference({ key, ids });
    try {
      if (!storage) throw new Error("Storage unavailable");
      storage.setItem(key, JSON.stringify(ids));
      setError("");
    } catch {
      setError("Shortcuts changed for this visit. Your browser could not save them.");
    }
  };
  const togglePin = (id: SidebarShortcutId) => {
    if (pinned.includes(id)) save(pinned.filter((pin) => pin !== id));
    else if (pinned.length < PIN_LIMIT) save([...pinned, id]);
    else setReplacement(id);
  };
  const setExplore = (open: boolean) => {
    if (!open) setReplacement(null);
    onExploreOpenChange(open);
  };

  return (
    <>
      <nav className="kova-drawer-shortcuts" aria-label="Quick navigation">
        <Link
          to="/"
          aria-current={isCurrent("/") ? "page" : undefined}
          onClick={() => onNavigate("/")}
        >
          <MessageSquare aria-hidden="true" />
          Home
        </Link>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={exploreOpen}
          onClick={() => setExplore(true)}
        >
          <Compass aria-hidden="true" />
          Explore
        </button>
        {pinned.map((id) => {
          const item = pinnable.find((option) => option.id === id)!;
          const Icon = icons[id];
          return (
            <ContextMenu key={id}>
              <ContextMenuTrigger asChild>
                <Link
                  to={item.to}
                  aria-label={`Pinned shortcut: ${item.label}`}
                  aria-current={isCurrent(item.to) ? "page" : undefined}
                  onClick={() => onNavigate(item.to)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => togglePin(id)}>
                  <PinOff aria-hidden="true" />
                  Unpin {item.label}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </nav>
      <MobileBottomSheet open={exploreOpen} onOpenChange={setExplore} title="Explore" expandable>
        {error && (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            {error}
          </p>
        )}
        {replacementItem ? (
          <section aria-label={`Replace a shortcut with ${replacementItem.label}`}>
            <h3 className="mb-2 font-medium">Replace a shortcut with {replacementItem.label}</h3>
            <div className="grid gap-2">
              {pinned.map((id) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  className="min-h-11 justify-start"
                  onClick={() => {
                    save(pinned.map((pin) => (pin === id ? replacementItem.id : pin)));
                    setReplacement(null);
                  }}
                >
                  Replace {pinnable.find((item) => item.id === id)?.label}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 justify-start"
                onClick={() => setReplacement(null)}
              >
                Cancel
              </Button>
            </div>
          </section>
        ) : (
          <ul className="kova-explore-shortcuts">
            {shortcuts.map((item) => {
              const Icon = icons[item.id];
              const isPinned = pinned.includes(item.id);
              const link = (
                <Link
                  to={item.to}
                  onClick={(event) => {
                    setExplore(false);
                    if (item.id === "settings") {
                      event.preventDefault();
                      onOpenSettings();
                    } else {
                      onNavigate(item.to);
                    }
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
              return (
                <li key={item.id} data-pinnable={item.id !== "settings" || undefined}>
                  {item.id === "settings" ? (
                    link
                  ) : (
                    <>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
                        <ContextMenuContent className="z-[110]">
                          <ContextMenuItem onSelect={() => togglePin(item.id)}>
                            {isPinned ? "Unpin" : "Pin"} {item.label}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                      <button
                        type="button"
                        aria-label={`${isPinned ? "Unpin" : "Pin"} ${item.label}`}
                        aria-pressed={isPinned}
                        onClick={() => togglePin(item.id)}
                      >
                        <Pin aria-hidden="true" fill={isPinned ? "currentColor" : "none"} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </MobileBottomSheet>
    </>
  );
}
