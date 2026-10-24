import {
  NewChatGlyph,
  LibraryGlyph,
  ProjectsGlyph,
  ImagesGlyph,
  TasksGlyph,
  PluginsGlyph,
  SidebarGlyphIcon,
  SearchGlyph,
  SettingsGlyph,
  MoreGlyph,
  CustomizeGlyph,
  type SidebarGlyph,
} from "@/components/SidebarIcons";
import {
  Archive,
  Plus,
  MessageSquare,
  ChevronDown,
  BarChart3,
  LogOut,
  BriefcaseBusiness,
  Compass,
  Map,
  CircleHelp,
  Copy as CopyIcon,
  CreditCard,
  Ellipsis,
  Folder,
  Pin,
  PinOff,
  Pencil,
  Settings as SettingsIcon,
  Share2,
  Trash2,
  X,
  UserRound,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { NovaLogo } from "@/components/NovaLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTier } from "@/hooks/useTier";
import type { Conversation } from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import {
  DEFAULT_SIDEBAR_SHORTCUTS,
  readSidebarShortcuts,
  resetSidebarShortcuts,
  saveSidebarShortcuts,
  SIDEBAR_SHORTCUTS,
  sidebarShortcutsKey,
  type SidebarShortcutId,
} from "@/lib/sidebar-shortcuts.mjs";
import "@/styles/sidebar-personalization.css";
import { requestDrawerNavigationFocus } from "@/lib/drawer-navigation-focus";

const EXPANDED_WIDTH = 248;
const SHORTCUT_ICONS: Record<SidebarShortcutId, SidebarGlyph> = {
  images: ImagesGlyph,
  library: LibraryGlyph,
  projects: ProjectsGlyph,
  "scheduled-tasks": TasksGlyph,
  apps: PluginsGlyph,
  work: BriefcaseBusiness,
  discovery: Compass,
  maps: Map,
};
const ChatProjectDialog = lazy(() =>
  import("@/components/ChatProjectDialog").then((module) => ({
    default: module.ChatProjectDialog,
  })),
);

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

function RailTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onShare,
  onDuplicate,
  onArchive,
  onTogglePin,
  open,
  onToggle,
  onOpenSettings,
  onOpenHelp,
  onOpenWorkspaceSearch,
  mapsReleaseApproved = false,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void | boolean | Promise<void | boolean>;
  onShare?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onArchive?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenHelp: () => void;
  onOpenWorkspaceSearch?: () => void;
  mapsReleaseApproved?: boolean;
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const { tier, status: tierStatus } = useTier();
  const drawerRef = useRef<HTMLElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const navigationOwnsFocusRef = useRef(false);
  const renameDialogRef = useRef<HTMLDialogElement | null>(null);
  const chatOptionsRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  const renameReturnFocusRef = useRef<{ target: HTMLButtonElement | null; context: string } | null>(
    null,
  );
  const archiveReturnFocusRef = useRef<{ id: string; context: string } | null>(null);
  const pinReturnFocusRef = useRef<{
    id: string;
    context: string;
    url: string;
    group: "sidebar-pinned-heading" | "sidebar-chats-heading";
    trigger: HTMLElement | null;
    menu: HTMLElement | null;
    frame: number | null;
  } | null>(null);
  const selectTimerRef = useRef<number | null>(null);
  const selectionPointerTypeRef = useRef<string | null>(null);
  const renameOperationRef = useRef<object | null>(null);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renameChat, setRenameChat] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [projectChat, setProjectChat] = useState<Conversation | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [renameDiscard, setRenameDiscard] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const keepRenameRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (renameDiscard) keepRenameRef.current?.focus();
  }, [renameDiscard]);
  const [mobileViewport, setMobileViewport] = useState(false);
  const railDialogRef = useRef<HTMLDialogElement | null>(null);
  const railReturnFocusRef = useRef<HTMLElement | null>(null);
  const [railDialogOwner, setRailDialogOwner] = useState<string | null>(null);
  const [railPreferences, setRailPreferences] = useState<{
    owner: string | undefined;
    shortcuts: readonly SidebarShortcutId[];
  }>({ owner: undefined, shortcuts: DEFAULT_SIDEBAR_SHORTCUTS });
  const [railSaveError, setRailSaveError] = useState("");

  const signedIn = isLoaded && isSignedIn;
  const canSchedule = signedIn;
  const railOwner = signedIn ? user?.id : undefined;
  // Never show the previous account's choices during an identity transition.
  const railShortcuts =
    railPreferences.owner === railOwner ? railPreferences.shortcuts : DEFAULT_SIDEBAR_SHORTCUTS;
  const railDialogOpen = Boolean(railOwner && railDialogOwner === railOwner);
  const availableShortcuts = SIDEBAR_SHORTCUTS.filter(
    (shortcut) =>
      ["images", "work", "discovery", "maps"].includes(shortcut.id) &&
      (shortcut.id !== "maps" || mapsReleaseApproved),
  );
  const collapsed = !open;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const chatActionContext = `${user?.id ?? ""}:${isLoaded}:${isSignedIn}:${pathname}:${open}`;
  const chatActionContextRef = useRef(chatActionContext);
  chatActionContextRef.current = chatActionContext;
  useEffect(() => {
    renameReturnFocusRef.current = null;
    archiveReturnFocusRef.current = null;
  }, [chatActionContext]);
  useEffect(() => {
    const cancelPinFocus = () => {
      const pending = pinReturnFocusRef.current;
      if (pending?.frame !== null && pending?.frame !== undefined)
        window.cancelAnimationFrame(pending.frame);
      pinReturnFocusRef.current = null;
    };
    const relinquishPinFocus = (event: Event) => {
      const pending = pinReturnFocusRef.current;
      if (!pending || !(event.target instanceof Node)) return;
      if (event.type === "focusin" && event.target === document.body) return;
      if (pending.menu?.contains(event.target) || pending.trigger?.contains(event.target)) return;
      cancelPinFocus();
    };
    document.addEventListener("focusin", relinquishPinFocus, true);
    document.addEventListener("pointerdown", relinquishPinFocus, true);
    return () => {
      cancelPinFocus();
      document.removeEventListener("focusin", relinquishPinFocus, true);
      document.removeEventListener("pointerdown", relinquishPinFocus, true);
    };
  }, [chatActionContext]);

  const beginPin = (conversation: Conversation, item: HTMLElement) => {
    if (!onTogglePin || chatActionContextRef.current !== chatActionContext) return;
    pinReturnFocusRef.current = {
      id: conversation.id,
      context: chatActionContext,
      url: window.location.href,
      group: conversation.pinned ? "sidebar-chats-heading" : "sidebar-pinned-heading",
      trigger: chatOptionsRefs.current.get(conversation.id) ?? null,
      menu: item.closest<HTMLElement>('[role="menu"]'),
      frame: null,
    };
    onTogglePin(conversation.id);
  };
  const closePinMenu = (id: string, event: Event) => {
    const pending = pinReturnFocusRef.current;
    if (!pending || pending.id !== id) return false;
    event.preventDefault();
    if (pending.frame !== null) window.cancelAnimationFrame(pending.frame);
    // The row can remount in another group. Resolve its new Actions trigger only after
    // the closing menu's focus scope has finished; never retain the detached old node.
    pending.frame = window.requestAnimationFrame(() => {
      if (pinReturnFocusRef.current !== pending) return;
      pinReturnFocusRef.current = null;
      if (pending.context !== chatActionContextRef.current || pending.url !== window.location.href)
        return;
      const target = chatOptionsRefs.current.get(pending.id);
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== pending.trigger &&
        active !== target &&
        !pending.menu?.contains(active)
      )
        return;
      const heading =
        drawerRef.current?.querySelector<HTMLElement>(`#${pending.group}`) ??
        drawerRef.current?.querySelector<HTMLElement>(
          "#sidebar-chats-heading, #sidebar-pinned-heading",
        );
      const next = [target, heading].find(
        (element) =>
          element?.isConnected &&
          element.offsetParent !== null &&
          !element.closest('[inert], [aria-hidden="true"]') &&
          !element.matches(":disabled"),
      );
      next?.focus({ preventScroll: true });
    });
    return true;
  };

  const isOn = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  useEffect(() => {
    const refresh = () => {
      setRailPreferences({
        owner: railOwner,
        shortcuts: readSidebarShortcuts(safeBrowserStorage("localStorage"), railOwner),
      });
      setRailSaveError("");
    };
    refresh();
    setRailDialogOwner(null);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === sidebarShortcutsKey(railOwner)) refresh();
    };
    const onCleared = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, railOwner)) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onCleared);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onCleared);
    };
  }, [railOwner]);

  useEffect(() => {
    const dialog = railDialogRef.current;
    if (railDialogOpen && dialog && !dialog.open) dialog.showModal();
    else if (!railDialogOpen && dialog?.open) dialog.close();
  }, [railDialogOpen]);

  const openRailPersonalization = (trigger: HTMLElement) => {
    if (!railOwner) return;
    railReturnFocusRef.current = trigger;
    setRailSaveError("");
    setRailDialogOwner(railOwner);
  };
  const closeRailPersonalization = () => {
    railDialogRef.current?.close();
    setRailDialogOwner(null);
    const trigger = railReturnFocusRef.current;
    if (trigger?.isConnected && trigger.offsetParent !== null && !trigger.closest("[inert]"))
      trigger.focus({ preventScroll: true });
  };
  const changeRailShortcuts = (shortcuts: readonly SidebarShortcutId[]) => {
    if (!railOwner) return;
    setRailPreferences({ owner: railOwner, shortcuts });
    setRailSaveError(
      saveSidebarShortcuts(safeBrowserStorage("localStorage"), railOwner, shortcuts)
        ? ""
        : "Your choices apply now, but this browser could not save them. Try again to keep them after reload.",
    );
  };

  const cancelPendingSelection = useCallback(() => {
    if (selectTimerRef.current !== null) window.clearTimeout(selectTimerRef.current);
    selectTimerRef.current = null;
  }, []);
  useEffect(() => cancelPendingSelection, [cancelPendingSelection]);
  useEffect(() => {
    if (!open) cancelPendingSelection();
  }, [open, cancelPendingSelection]);
  useEffect(() => {
    cancelPendingSelection();
    renameOperationRef.current = null;
    setRenameChat(null);
    setProjectChat(null);
    setRenamePending(false);
    setRenameError("");
    setSearchQuery("");
    setSearchOpen(false);
  }, [user?.id, isLoaded, isSignedIn, cancelPendingSelection]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const dialog = renameDialogRef.current;
    if (renameChat && dialog && !dialog.open) dialog.showModal();
    else if (!renameChat && dialog?.open) dialog.close();
  }, [renameChat]);

  const swipeToggleRef = useRef(onToggle);
  useEffect(() => {
    swipeToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    if (open) return;
    let gesture: { id: number; x: number; y: number; time: number } | null = null;
    const reset = () => {
      gesture = null;
    };
    const start = (event: TouchEvent) => {
      reset();
      const target = event.target;
      if (
        !isMobileViewport() ||
        event.touches.length !== 1 ||
        !(target instanceof Element) ||
        !target.closest(".kova-assistant, .kova-app-shell") ||
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) ||
        document.querySelector('[aria-modal="true"], dialog[open]') ||
        !window.getSelection()?.isCollapsed
      )
        return;
      // Native horizontal scrollers (code, tables, carousels) retain their gesture.
      for (let element: Element | null = target; element; element = element.parentElement) {
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          /^(auto|scroll)$/.test(getComputedStyle(element).overflowX)
        )
          return;
      }
      const touch = event.touches[0];
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== gesture.id || !isMobileViewport()) {
        reset();
        return;
      }
      const dx = touch.clientX - gesture.x;
      const dy = Math.abs(touch.clientY - gesture.y);
      if (event.timeStamp - gesture.time > 700 || dx < -24 || (dy > 24 && dy > Math.abs(dx))) {
        reset();
        return;
      }
      // A clear, quick right swipe can start anywhere on the page.
      if (dx >= 96 && dy <= 48 && dx >= dy * 2) {
        reset();
        swipeToggleRef.current();
      }
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", reset);
    document.addEventListener("touchcancel", reset);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", reset);
      document.removeEventListener("touchcancel", reset);
    };
  }, [open]);

  useEffect(() => {
    const openSearch = () => {
      setSearchOpen(true);
      if (!open) onToggle();
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>("#sidebar-chat-search")?.focus(),
      );
    };
    window.addEventListener("kova-open-search", openSearch);
    return () => window.removeEventListener("kova-open-search", openSearch);
  }, [open, onToggle]);

  useEffect(() => {
    if (!open || !mobileViewport) return;
    navigationOwnsFocusRef.current = false;
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const content = drawerRef.current
      ?.closest(".kova-assistant, .kova-app-shell")
      ?.querySelector<HTMLElement>(".kova-chat-main, .kova-app-content");
    const previousInert = content?.inert ?? false;
    if (content) content.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>('[aria-label="Close sidebar"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const nested =
        event.target instanceof Element
          ? event.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], dialog')
          : null;
      if (nested && nested !== drawerRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        swipeToggleRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const items = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!items.length) return;
      const [first] = items;
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (content) content.inert = previousInert;
      document.removeEventListener("keydown", onKeyDown);
      if (navigationOwnsFocusRef.current) return;
      requestAnimationFrame(() => {
        // A newly opened account dialog owns focus; do not pull it back underneath.
        if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
        const previous = lastFocusedRef.current;
        if (previous?.isConnected && previous.offsetParent !== null) previous.focus();
        else
          document
            .querySelector<HTMLElement>('[aria-label="Open menu"], [aria-label="Open sidebar"]')
            ?.focus();
      });
    };
  }, [open, mobileViewport]);

  useEffect(() => {
    if (!open || mobileViewport) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        (event.target instanceof Element &&
          event.target.closest('[role="menu"], [role="dialog"], dialog'))
      )
        return;
      event.preventDefault();
      swipeToggleRef.current();
      requestAnimationFrame(() => {
        if (signedIn) expandButtonRef.current?.focus();
        else document.querySelector<HTMLElement>('[aria-label="Open sidebar"]')?.focus();
      });
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, mobileViewport, signedIn]);

  const closeAfterMobileNavigation = (destination?: string) => {
    cancelPendingSelection();
    if (!open || !isMobileViewport()) return;
    if (destination)
      navigationOwnsFocusRef.current = requestDrawerNavigationFocus({
        destination,
        source: drawerRef.current,
      });
    swipeToggleRef.current();
  };
  const closeRename = () => {
    const returnFocus = renameReturnFocusRef.current;
    renameReturnFocusRef.current = null;
    renameDialogRef.current?.close();
    setRenameChat(null);
    if (returnFocus?.context === chatActionContextRef.current)
      restoreChatActionFocus(returnFocus.target, drawerRef.current);
  };
  const keepRename = () => {
    setRenameDiscard(false);
    requestAnimationFrame(() => renameInputRef.current?.focus());
  };
  const requestCloseRename = () => {
    if (renamePending) return;
    if (renameTitle !== renameChat?.title) setRenameDiscard(true);
    else closeRename();
  };
  const beginRename = (conversation: Conversation, trigger?: HTMLButtonElement) => {
    if (renamePending) return;
    cancelPendingSelection();
    renameReturnFocusRef.current = {
      target: trigger ?? chatOptionsRefs.current.get(conversation.id) ?? null,
      context: chatActionContextRef.current,
    };
    setRenameChat(conversation);
    setRenameDiscard(false);
    setRenameTitle(conversation.title);
    setRenameError("");
  };
  const navRow = (active = false) => `kova-nav-row ${active ? "is-active" : ""}`;
  const icon = (Icon: SidebarGlyph) => (
    <span className="kova-sidebar-icon" aria-hidden="true">
      <Icon />
    </span>
  );
  const navLink = (to: string, label: string, Icon: SidebarGlyph, badge?: string) => (
    <Link
      to={to as never}
      className={navRow(isOn(to))}
      aria-current={isOn(to) ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        closeAfterMobileNavigation(to);
      }}
    >
      {icon(Icon)}
      <span className="kova-sidebar-label">{label}</span>
      {badge ? <span className="kova-sidebar-badge">{badge}</span> : null}
    </Link>
  );
  const railLink = (to: string, label: string, Icon: SidebarGlyph) => (
    <RailTooltip key={to} label={label}>
      <Link
        to={to as never}
        className="kova-rail-button relative"
        aria-label={label}
        aria-current={isOn(to) ? "page" : undefined}
      >
        <Icon aria-hidden="true" />
      </Link>
    </RailTooltip>
  );

  const query = searchQuery.trim();
  const savedConversations = signedIn ? conversations : [];
  const filtered = query
    ? searchConversations(savedConversations, query).map((result) => result.conversation)
    : savedConversations;
  const pinned = filtered
    .filter((conversation) => conversation.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const recents = filtered
    .filter((conversation) => !conversation.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const chatRow = (conversation: Conversation) => (
    <div
      key={conversation.id}
      className={`kova-chat-row group ${activeId === conversation.id ? "is-active" : ""}`}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="kova-chat-row-main"
              onPointerDown={(event) => {
                selectionPointerTypeRef.current = event.pointerType;
              }}
              onClick={(event) => {
                const pointerType = selectionPointerTypeRef.current;
                const fineMouse =
                  pointerType === "mouse" ||
                  (pointerType === null &&
                    window.matchMedia("(hover: hover) and (pointer: fine)").matches);
                cancelPendingSelection();
                const select = () => {
                  selectTimerRef.current = null;
                  closeAfterMobileNavigation("/");
                  onSelect(conversation.id);
                };
                // Keep double-click rename on the current page; keyboard and touch stay immediate.
                if (onRename && event.detail > 0 && fineMouse && !isMobileViewport())
                  selectTimerRef.current = window.setTimeout(select, 350);
                else select();
              }}
              onDoubleClick={(event) => {
                if (
                  !onRename ||
                  renamePending ||
                  selectionPointerTypeRef.current === "touch" ||
                  selectionPointerTypeRef.current === "pen" ||
                  (selectionPointerTypeRef.current === null &&
                    !window.matchMedia("(hover: hover) and (pointer: fine)").matches)
                )
                  return;
                event.preventDefault();
                beginRename(conversation, event.currentTarget);
              }}
              aria-label={`Open chat ${conversation.title}`}
              aria-current={activeId === conversation.id ? "page" : undefined}
            >
              <span className="truncate">{conversation.title}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            collisionPadding={8}
            className="max-w-[min(240px,calc(100vw-16px))] whitespace-normal break-words"
          >
            {conversation.title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="kova-chat-options"
            ref={(element) => {
              if (element) chatOptionsRefs.current.set(conversation.id, element);
              else chatOptionsRefs.current.delete(conversation.id);
            }}
            aria-label={`Options for ${conversation.title}`}
          >
            <Ellipsis aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="kova-sidebar-chat-menu"
          onCloseAutoFocus={(event) => {
            if (closePinMenu(conversation.id, event)) return;
            const pending = archiveReturnFocusRef.current;
            if (pending?.id !== conversation.id) return;
            archiveReturnFocusRef.current = null;
            event.preventDefault();
            if (pending.context === chatActionContextRef.current)
              restoreChatActionFocus(
                chatOptionsRefs.current.get(conversation.id) ?? null,
                drawerRef.current,
              );
          }}
        >
          {onRename ? (
            <DropdownMenuItem onClick={() => beginRename(conversation)}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {onTogglePin ? (
            <DropdownMenuItem onClick={(event) => beginPin(conversation, event.currentTarget)}>
              {conversation.pinned ? (
                <PinOff className="mr-2 h-4 w-4" />
              ) : (
                <Pin className="mr-2 h-4 w-4" />
              )}
              {conversation.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
          ) : null}
          {onShare ? (
            <DropdownMenuItem onClick={() => onShare(conversation.id)}>
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </DropdownMenuItem>
          ) : null}
          {onDuplicate ? (
            <DropdownMenuItem onClick={() => onDuplicate(conversation.id)}>
              <CopyIcon className="mr-2 h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
          ) : null}
          {signedIn ? (
            <DropdownMenuItem
              onSelect={() => {
                cancelPendingSelection();
                setProjectChat(conversation);
                closeAfterMobileNavigation();
              }}
            >
              <Folder className="mr-2 h-4 w-4" /> Add to project
            </DropdownMenuItem>
          ) : null}
          {onArchive ? (
            <DropdownMenuItem
              onClick={() => {
                archiveReturnFocusRef.current = {
                  id: conversation.id,
                  context: chatActionContextRef.current,
                };
                onArchive(conversation.id);
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(conversation.id)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const accountName = user?.fullName || user?.firstName || user?.username || null;
  const accountEmail = user?.email || null;
  const displayName = !isLoaded
    ? "Loading account…"
    : accountName || accountEmail || "Account details unavailable";
  const avatarUrl = isLoaded ? user?.imageUrl || null : null;
  const accountInitial = isLoaded && accountName ? accountName.charAt(0).toUpperCase() : null;
  const planLabel =
    tierStatus === "loading"
      ? "Loading plan…"
      : tierStatus === "ready"
        ? tier === "pro"
          ? "Pro"
          : tier === "plus"
            ? "Plus"
            : "Free"
        : "Plan unavailable";

  return (
    <>
      {railDialogOpen ? (
        <dialog
          ref={railDialogRef}
          className="kova-sidebar-personalization"
          aria-labelledby="sidebar-personalization-title"
          aria-describedby="sidebar-personalization-description"
          aria-modal="true"
          onCancel={(event) => {
            event.preventDefault();
            closeRailPersonalization();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              closeRailPersonalization();
          }}
        >
          <div className="kova-sidebar-personalization-heading">
            <h2 id="sidebar-personalization-title">Customize sidebar</h2>
            <button
              type="button"
              aria-label="Close sidebar customization"
              onClick={closeRailPersonalization}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <p id="sidebar-personalization-description">
            Choose additional shortcuts for your collapsed desktop sidebar. New chat, Search, Chat,
            Projects, Scheduled tasks, Library, Plugins, and your account stay available.
          </p>
          <fieldset>
            <legend>Additional shortcuts</legend>
            {availableShortcuts.map((shortcut) => {
              const Icon = SHORTCUT_ICONS[shortcut.id];
              return (
                <label key={shortcut.id} className="kova-sidebar-shortcut-choice">
                  <Icon aria-hidden="true" />
                  <span>{shortcut.label}</span>
                  <Switch
                    aria-label={shortcut.label}
                    checked={railShortcuts.includes(shortcut.id)}
                    onCheckedChange={(checked) =>
                      changeRailShortcuts(
                        checked
                          ? [...railShortcuts, shortcut.id]
                          : railShortcuts.filter((id) => id !== shortcut.id),
                      )
                    }
                  />
                </label>
              );
            })}
          </fieldset>
          <p className="kova-sidebar-personalization-note">
            Saved for this account in this browser.
          </p>
          {railSaveError ? (
            <p role="alert" className="kova-sidebar-personalization-error">
              {railSaveError}
            </p>
          ) : null}
          <div className="kova-sidebar-personalization-actions">
            <button
              type="button"
              onClick={() => {
                setRailPreferences({ owner: railOwner, shortcuts: DEFAULT_SIDEBAR_SHORTCUTS });
                setRailSaveError(
                  resetSidebarShortcuts(safeBrowserStorage("localStorage"), railOwner)
                    ? ""
                    : "Defaults apply now, but this browser could not save the reset. Try again.",
                );
              }}
            >
              Reset to default
            </button>
            <button type="button" onClick={closeRailPersonalization}>
              Done
            </button>
          </div>
        </dialog>
      ) : null}
      {projectChat ? (
        <Suspense fallback={null}>
          <ChatProjectDialog
            open
            conversation={projectChat}
            onOpenChange={(value) => {
              if (!value) setProjectChat(null);
            }}
          />
        </Suspense>
      ) : null}
      {renameChat ? (
        <dialog
          ref={renameDialogRef}
          data-kova-dialog-surface
          aria-labelledby="rename-chat-title"
          aria-modal="true"
          className="kova-rename-dialog m-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/50"
          onCancel={(event) => {
            event.preventDefault();
            if (renameDiscard) keepRename();
            else requestCloseRename();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget || renamePending) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              requestCloseRename();
          }}
        >
          {renameDiscard && (
            <section
              role="alertdialog"
              aria-labelledby="rename-discard-title"
              aria-describedby="rename-discard-description"
            >
              <h2 id="rename-discard-title" className="text-lg font-semibold">
                Discard name changes?
              </h2>
              <p id="rename-discard-description" className="mt-3 text-sm">
                The saved name for “{renameChat.title}” will stay unchanged.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  ref={keepRenameRef}
                  type="button"
                  className="min-h-11 px-4"
                  onClick={keepRename}
                >
                  Keep editing
                </button>
                <button type="button" className="min-h-11 px-4" onClick={closeRename}>
                  Discard changes
                </button>
              </div>
            </section>
          )}
          <form
            hidden={renameDiscard}
            onSubmit={async (event) => {
              event.preventDefault();
              const title = renameTitle.trim();
              if (!title || renamePending || !onRename) return;
              const account = accountRef.current;
              const operation = {};
              renameOperationRef.current = operation;
              const current = () =>
                accountRef.current === account && renameOperationRef.current === operation;
              setRenamePending(true);
              setRenameError("");
              try {
                const saved = await onRename(renameChat.id, title);
                if (!current()) return;
                if (saved === false)
                  setRenameError("This chat could not be renamed. Please retry.");
                else closeRename();
              } catch {
                if (current()) setRenameError("This chat could not be renamed. Please retry.");
              } finally {
                if (current()) {
                  setRenamePending(false);
                  renameOperationRef.current = null;
                }
              }
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="rename-chat-title" className="text-lg font-semibold">
                Rename chat
              </h2>
              <button
                type="button"
                aria-label="Close rename chat"
                disabled={renamePending}
                className="grid size-11 shrink-0 place-items-center"
                onClick={requestCloseRename}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-4 block text-sm" htmlFor="rename-chat-name">
              Chat name
            </label>
            <input
              id="rename-chat-name"
              ref={renameInputRef}
              aria-invalid={!!renameError}
              aria-describedby={renameError ? "rename-chat-error" : undefined}
              autoFocus
              value={renameTitle}
              maxLength={160}
              disabled={renamePending}
              onChange={(event) => setRenameTitle(event.target.value)}
              className="mt-4 min-h-11 w-full rounded-xl border border-border bg-background px-3"
            />
            {renameError ? (
              <p id="rename-chat-error" role="alert" className="mt-3 text-sm text-destructive">
                {renameError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={renamePending}
                onClick={requestCloseRename}
                className="min-h-11 rounded-full px-4"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renamePending || !renameTitle.trim()}
                className="min-h-11 rounded-full bg-foreground px-4 text-background disabled:opacity-50"
              >
                {renamePending ? (
                  <span className="spec400-loading-label">
                    <span className="spec400-loading-spinner" aria-hidden="true" />
                    Saving…
                  </span>
                ) : (
                  "Rename"
                )}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        className="kova-sidebar-scrim fixed inset-0 z-30 bg-black/45 lg:hidden"
        aria-label="Close navigation menu"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open || !mobileViewport}
        disabled={!open}
        tabIndex={-1}
      />

      {signedIn ? (
        <TooltipProvider>
          <nav
            className="kova-sidebar-rail hidden h-[100dvh] w-[72px] shrink-0 flex-col items-center bg-sidebar lg:flex"
            aria-label="Collapsed navigation"
            data-kova-core-rail=""
            data-kova-refined-sidebar=""
            data-state={collapsed ? "open" : "closed"}
            aria-hidden={!collapsed}
            inert={!collapsed}
          >
            <div className="flex h-16 min-h-16 shrink-0 items-center justify-center">
              <RailTooltip label="Expand sidebar">
                <button
                  ref={expandButtonRef}
                  type="button"
                  onClick={(event) => {
                    const keyboardActivated = event.detail === 0;
                    onToggle();
                    if (!keyboardActivated) return;
                    requestAnimationFrame(() =>
                      drawerRef.current
                        ?.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')
                        ?.focus({ preventScroll: true }),
                    );
                  }}
                  className="kova-rail-button kova-sidebar-toggle"
                  aria-label="Expand sidebar"
                >
                  <NovaLogo decorative className="h-7 w-7" />
                </button>
              </RailTooltip>
            </div>
            <div className="kova-rail-shortcuts">
              <div
                role="group"
                aria-label="Primary destinations"
                className="flex shrink-0 flex-col items-center gap-2"
              >
                <RailTooltip label="New chat">
                  <button
                    type="button"
                    onClick={onNew}
                    className="kova-rail-button kova-new-chat"
                    aria-label="New chat"
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </RailTooltip>
                <RailTooltip label="Search">
                  <button
                    type="button"
                    className="kova-rail-button"
                    aria-label="Search"
                    onClick={() => {
                      if (onOpenWorkspaceSearch) onOpenWorkspaceSearch();
                      else {
                        setSearchOpen(true);
                        if (!open) onToggle();
                      }
                    }}
                  >
                    <SearchGlyph aria-hidden="true" />
                  </button>
                </RailTooltip>
                {railLink("/", "Chat", MessageSquare)}
                {signedIn ? railLink("/projects", "Projects", ProjectsGlyph) : null}
                {canSchedule ? railLink("/scheduled-tasks", "Scheduled tasks", TasksGlyph) : null}
                {signedIn ? railLink("/library", "Library", LibraryGlyph) : null}
                {railLink("/apps", "Plugins", PluginsGlyph)}
              </div>
              {railShortcuts.some((id) => availableShortcuts.some((item) => item.id === id)) ? (
                <div
                  role="group"
                  aria-label="Additional shortcuts"
                  className="flex shrink-0 flex-col items-center gap-2 border-t border-border pt-2"
                >
                  {railShortcuts.map((id) => {
                    const shortcut = availableShortcuts.find((item) => item.id === id);
                    if (!shortcut) return null;
                    return railLink(shortcut.to, shortcut.label, SHORTCUT_ICONS[id]);
                  })}
                </div>
              ) : null}
            </div>
            <RailTooltip label="Customize sidebar">
              <button
                type="button"
                className="kova-rail-button kova-rail-customize"
                onClick={(event) => openRailPersonalization(event.currentTarget)}
                aria-label="Customize sidebar"
                aria-haspopup="dialog"
              >
                <CustomizeGlyph aria-hidden="true" />
              </button>
            </RailTooltip>
            <RailTooltip label="Settings">
              <button
                type="button"
                className="kova-rail-account"
                onClick={() => onOpenSettings("general")}
                aria-label="Settings"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" />
                ) : (
                  <span aria-hidden="true">{accountInitial || <UserRound size={20} />}</span>
                )}
              </button>
            </RailTooltip>
          </nav>
        </TooltipProvider>
      ) : null}

      <aside
        ref={drawerRef}
        id="kova-primary-navigation"
        data-kova-core-sidebar=""
        data-kova-refined-sidebar=""
        style={{ "--sidebar-expanded": `${EXPANDED_WIDTH}px` } as React.CSSProperties}
        className={`kova-sidebar relative z-40 flex h-[100dvh] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 lg:w-[var(--sidebar-expanded)] ${collapsed ? "lg:!w-0" : ""} max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[min(88vw,320px)] ${open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"}`}
        aria-label="Primary navigation"
        data-state={open ? "open" : "closed"}
        aria-modal={open && mobileViewport ? true : undefined}
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed ? true : undefined}
        role={open && mobileViewport ? "dialog" : "navigation"}
      >
        <div className="kova-sidebar-inner flex h-full min-w-[var(--sidebar-expanded)] flex-col overflow-hidden">
          <header className="kova-sidebar-header">
            <span className="kova-sidebar-brand flex items-center gap-2">
              <NovaLogo decorative className="h-7 w-7" />
              KovaGPT
            </span>
            <div className="kova-sidebar-header-actions">
              <button
                type="button"
                className="kova-header-button flex"
                onClick={() => setSearchOpen((value) => !value)}
                aria-label="Search chats"
                title="Search chats"
              >
                <SearchGlyph />
              </button>
              <button
                type="button"
                className="kova-header-button kova-sidebar-toggle flex lg:hidden"
                onClick={onToggle}
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <X />
              </button>
              <button
                type="button"
                className="kova-header-button kova-sidebar-toggle hidden lg:flex"
                onClick={(event) => {
                  const keyboardActivated = event.detail === 0;
                  onToggle();
                  if (!keyboardActivated) return;
                  requestAnimationFrame(() => {
                    if (signedIn) expandButtonRef.current?.focus();
                    else
                      document.querySelector<HTMLElement>('[aria-label="Open sidebar"]')?.focus();
                  });
                }}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <SidebarGlyphIcon />
              </button>
            </div>
          </header>

          {searchOpen ? (
            <div className="kova-sidebar-search-wrap">
              <label className="sr-only" htmlFor="sidebar-chat-search">
                Search chats
              </label>
              <input
                id="sidebar-chat-search"
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search chats"
                className="kova-sidebar-search"
              />
            </div>
          ) : null}

          <div className="kova-sidebar-scroll">
            <nav className="kova-sidebar-primary" aria-label="KovaGPT features">
              <button
                type="button"
                onClick={() => {
                  closeAfterMobileNavigation("/");
                  onNew();
                }}
                className="kova-new-chat kova-nav-row"
                aria-label="New chat"
              >
                {icon(Plus)}
                <span>New chat</span>
              </button>
              {onOpenWorkspaceSearch ? (
                <button
                  type="button"
                  className="kova-nav-row"
                  onClick={() => {
                    if (mobileViewport && open) onToggle();
                    onOpenWorkspaceSearch();
                  }}
                >
                  {icon(SearchGlyph)}
                  <span>Search</span>
                </button>
              ) : null}
              {navLink("/", "Chat", MessageSquare)}
              {signedIn ? navLink("/projects", "Projects", ProjectsGlyph) : null}
              {canSchedule ? navLink("/scheduled-tasks", "Scheduled tasks", TasksGlyph) : null}
              {signedIn ? navLink("/library", "Library", LibraryGlyph) : null}
              {navLink("/apps", "Plugins", PluginsGlyph)}
              {navLink("/images", "Images", ImagesGlyph)}
              <details open={isOn("/work") || isOn("/discovery") || undefined}>
                <summary className="kova-nav-row cursor-pointer">
                  {icon(MoreGlyph)}
                  <span>More</span>
                </summary>
                {navLink("/work", "Work", BriefcaseBusiness)}
                {navLink("/discovery", "Discover", Compass)}
                {mapsReleaseApproved ? navLink("/maps", "Maps", Map) : null}
                {signedIn ? (
                  <button
                    type="button"
                    className="kova-nav-row"
                    aria-haspopup="dialog"
                    onClick={(event) => openRailPersonalization(event.currentTarget)}
                  >
                    {icon(CustomizeGlyph)}
                    <span>Customize sidebar</span>
                  </button>
                ) : null}
              </details>
            </nav>
            <section className="kova-sidebar-history" aria-label="Chats">
              {pinned.length > 0 ? (
                <div role="group" aria-labelledby="sidebar-pinned-heading">
                  <h2 id="sidebar-pinned-heading" tabIndex={-1}>
                    Pinned
                  </h2>
                  {pinned.slice(0, 8).map(chatRow)}
                </div>
              ) : null}
              {recents.length > 0 || pinned.length === 0 ? (
                <div role="group" aria-labelledby="sidebar-chats-heading">
                  <h2
                    id="sidebar-chats-heading"
                    tabIndex={-1}
                    className={pinned.length > 0 ? "kova-recents-heading" : undefined}
                  >
                    Recent chats
                  </h2>
                  {recents.slice(0, 8).map(chatRow)}
                </div>
              ) : null}
              {filtered.length > 0 ? (
                <button
                  className="kova-nav-row"
                  type="button"
                  onClick={() => {
                    if (onOpenWorkspaceSearch) onOpenWorkspaceSearch();
                    else setSearchOpen(true);
                  }}
                >
                  View all chats
                </button>
              ) : null}
              {savedConversations.length === 0 ? (
                <p className="kova-sidebar-empty">
                  No saved chats here.
                  {isLoaded && !signedIn ? (
                    <span className="mt-1 block">Log in to view saved chats.</span>
                  ) : null}
                </p>
              ) : null}
              {query && savedConversations.length > 0 && filtered.length === 0 ? (
                <p className="kova-sidebar-empty">No matches</p>
              ) : null}
            </section>
          </div>

          <div className="kova-sidebar-help">
            <button
              className="kova-nav-row"
              type="button"
              onClick={() => {
                closeAfterMobileNavigation("/help");
                onOpenHelp();
              }}
            >
              {icon(CircleHelp)}
              <span>Help</span>
            </button>
          </div>
          <footer className="kova-sidebar-footer">
            {signedIn ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="kova-account-main" aria-label="Account menu">
                      <span className="kova-account-avatar">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="" />
                        ) : (
                          accountInitial || <UserRound size={20} aria-hidden="true" />
                        )}
                      </span>
                      <span className="kova-account-copy">
                        <strong>{displayName}</strong>
                        <small>{planLabel}</small>
                      </span>
                      <ChevronDown className="ml-auto h-4 w-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end" className="kova-profile-menu">
                    <DropdownMenuLabel className="max-w-64 break-words font-normal">
                      {accountEmail || "Email unavailable"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation("/settings/profile");
                        onOpenSettings("personalization");
                      }}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation("/settings/appearance");
                        onOpenSettings("appearance");
                      }}
                    >
                      <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation("/settings/usage");
                        onOpenSettings("usage");
                      }}
                    >
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Usage
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation("/settings/billing");
                        onOpenSettings("billing");
                      }}
                    >
                      <CreditCard className="mr-2 h-4 w-4" />
                      Billing
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation("/help");
                        onOpenHelp();
                      }}
                    >
                      <CircleHelp className="mr-2 h-4 w-4" /> Help
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        closeAfterMobileNavigation();
                        onOpenSettings("logout");
                      }}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : isLoaded ? (
              <div className="w-full">
                <nav className="kova-guest-account-options" aria-label="Account options">
                  {navLink("/pricing", "Plans", CreditCard)}
                  <button
                    type="button"
                    className={navRow()}
                    onClick={() => {
                      closeAfterMobileNavigation();
                      onOpenHelp();
                    }}
                  >
                    {icon(CircleHelp)}
                    <span>Help</span>
                  </button>
                  <button
                    type="button"
                    className={navRow()}
                    aria-label="Settings"
                    onClick={() => {
                      closeAfterMobileNavigation();
                      onOpenSettings("general");
                    }}
                  >
                    {icon(SettingsGlyph)}
                    <span>Settings</span>
                  </button>
                </nav>
                <div className="flex items-center gap-2">
                  <SignInButton mode="modal">
                    <button type="button" className="kova-sign-in min-w-0 flex-1">
                      Log in to KovaGPT
                    </button>
                  </SignInButton>
                </div>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                Loading account…
              </p>
            )}
          </footer>
        </div>
      </aside>
    </>
  );
}

// Restore only to a visible control in the current sidebar, never a detached menu item.
function restoreChatActionFocus(target: HTMLElement | null, sidebar: HTMLElement | null) {
  const candidates = [
    target,
    ...(sidebar?.querySelectorAll<HTMLElement>(".kova-chat-row-main") ?? []),
    ...(sidebar?.querySelectorAll<HTMLElement>("[aria-label='New chat']") ?? []),
  ];
  const next = candidates.find(
    (element) =>
      element?.isConnected && element.offsetParent !== null && !element.closest("[inert]"),
  );
  next?.focus();
}
