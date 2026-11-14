import { readChatDeleteIntents, subscribeChatDeleteIntents } from "@/lib/chat-delete-undo";
import { resumePendingChatDeletions } from "@/lib/permanent-chat-delete";
import {
  NewChatGlyph,
  LibraryGlyph,
  ProjectsGlyph,
  ImagesGlyph,
  TasksGlyph,
  PluginsGlyph,
  SearchGlyph,
  SettingsGlyph,
  MoreGlyph,
  CustomizeGlyph,
  type SidebarGlyph,
} from "@/components/SidebarIcons";
import {
  Archive,
  Brain,
  Heart,
  CreditCard,
  Bell,
  PanelLeft,
  ArrowLeft,
  MessageSquare,
  ChevronDown,
  LogOut,
  Map,
  CircleHelp,
  Copy as CopyIcon,
  Ellipsis,
  Pin,
  PinOff,
  Pencil,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Trash2,
  X,
  UserRound,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAccountProfile } from "@/lib/use-account-profile";
import { SignInButton, useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import { NovaLogo } from "@/components/NovaLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatProjectSubmenu } from "@/components/ChatProjectSubmenu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatReplyActivity } from "@/hooks/useChatReplyActivity";
import { useTier } from "@/hooks/useTier";
import type { Conversation } from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import { type SidebarShortcutId } from "@/lib/sidebar-shortcuts.mjs";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  SIDEBAR_ITEMS,
  readSidebarLayout,
  saveSidebarLayout,
  sidebarLayoutKey,
  clampSidebarWidth,
  sidebarColors,
  type SidebarLayout,
} from "@/lib/sidebar-layout.mjs";
import "@/styles/sidebar-personalization.css";
import { requestDrawerNavigationFocus } from "@/lib/drawer-navigation-focus";
import { isClearSidebarSwipe } from "@/lib/sidebar-swipe.mjs";

const SHORTCUT_ICONS: Record<SidebarShortcutId, SidebarGlyph> = {
  images: ImagesGlyph,
  library: LibraryGlyph,
  projects: ProjectsGlyph,
  "scheduled-tasks": TasksGlyph,
  apps: PluginsGlyph,
  health: Heart,
  finances: CreditCard,
  maps: Map,
  memory: Brain,
  settings: SettingsGlyph,
  notifications: Bell,
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
  trackBackgroundReplies = false,
  activeId,
  onSelect,
  onNew,
  onDelete,
  deleteReady = true,
  onRename,
  onShare,
  onDuplicate,
  onTogglePin,
  open,
  onToggle,
  onOpenSettings,
  onOpenHelp,
  onOpenWorkspaceSearch,
  workspaceSearchOpen: externalWorkspaceSearchOpen = false,
  hideGuestLogin = false,
  mapsReleaseApproved = false,
  compactOnly = false,
}: {
  conversations: Conversation[];
  trackBackgroundReplies?: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  deleteReady?: boolean;
  onRename?: (id: string, title: string) => void | boolean | Promise<void | boolean>;
  onShare?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenHelp: () => void;
  onOpenWorkspaceSearch?: () => void;
  workspaceSearchOpen?: boolean;
  hideGuestLogin?: boolean;
  mapsReleaseApproved?: boolean;
  compactOnly?: boolean;
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const unreadReplyIds = useChatReplyActivity(
    trackBackgroundReplies && isLoaded && isSignedIn ? user?.id : undefined,
    conversations,
    activeId,
    onSelect,
  );
  const deleteOwner = isLoaded ? (isSignedIn ? user?.id : null) : undefined;
  const deleteOwnerRef = useRef(deleteOwner);
  deleteOwnerRef.current = deleteOwner;
  const [pendingDeleteState, setPendingDeleteState] = useState<{
    owner: string | null | undefined;
    ids: Set<string>;
  }>({ owner: undefined, ids: new Set() });
  const pendingDeleteIds =
    pendingDeleteState.owner === deleteOwner ? pendingDeleteState.ids : new Set<string>();
  useEffect(() => {
    if (!isLoaded) return;
    const owner = isSignedIn ? (user?.id ?? null) : null;
    let mounted = true;
    const update = () => {
      if (mounted) {
        const next = new Set(readChatDeleteIntents(owner).map((item) => item.id));
        setPendingDeleteState((previous) =>
          previous.owner === owner &&
          previous.ids.size === next.size &&
          [...previous.ids].every((id) => next.has(id))
            ? previous
            : { owner, ids: next },
        );
      }
    };
    const resume = () => {
      resumePendingChatDeletions(owner, () => mounted && deleteOwnerRef.current === owner);
      update();
    };
    const unsubscribe = subscribeChatDeleteIntents(update);
    update();
    resume();
    const timer = window.setInterval(() => {
      if (readChatDeleteIntents(owner).length) resume();
    }, 2000);
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith("kova-chat-delete-intents-v1:")) {
        update();
        resume();
      }
    };
    window.addEventListener("online", resume);
    window.addEventListener("storage", storage);
    return () => {
      mounted = false;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("storage", storage);
    };
  }, [isLoaded, isSignedIn, user?.id]);
  const clerk = useClerkSafe();
  const { tier, status: tierStatus } = useTier();
  const drawerRef = useRef<HTMLElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const navigationOwnsFocusRef = useRef(false);
  const renameDialogRef = useRef<HTMLDialogElement | null>(null);
  const chatOptionsRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  const chatPinRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
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
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const localSearchOpen = searchOpen && !onOpenWorkspaceSearch;
  const workspaceSearchOpen = externalWorkspaceSearchOpen || localSearchOpen;
  const searchDialogRef = useRef<HTMLDialogElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const searchOwnerRef = useRef(user?.id);
  const closeChatSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);
  useLayoutEffect(() => {
    if (searchOwnerRef.current === user?.id) return;
    searchOwnerRef.current = user?.id;
    closeChatSearch();
  }, [user?.id, closeChatSearch]);
  useLayoutEffect(() => {
    const dialog = searchDialogRef.current;
    if (!localSearchOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    searchInputRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      const target = searchReturnFocusRef.current;
      queueMicrotask(() => {
        if (target?.isConnected && target.offsetParent !== null && !target.closest("[inert]"))
          target.focus({ preventScroll: true });
      });
    };
  }, [localSearchOpen]);
  const [renameChat, setRenameChat] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [projectChat, setProjectChat] = useState<Conversation | null>(null);
  const [projectChoice, setProjectChoice] = useState("");
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
    layout: SidebarLayout;
  }>({ owner: undefined, layout: { ...DEFAULT_SIDEBAR_LAYOUT } });
  const [railSaveError, setRailSaveError] = useState("");
  const resizeRef = useRef<{
    owner: string;
    x: number;
    width: number;
    draft: number;
    layout: SidebarLayout;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const signedIn = isLoaded && isSignedIn;
  const railOwner = signedIn ? user?.id : undefined;
  const layout =
    railPreferences.owner === railOwner ? railPreferences.layout : { ...DEFAULT_SIDEBAR_LAYOUT };
  const railShortcuts = layout.shortcuts;
  const railDialogOpen = Boolean(railOwner && railDialogOwner === railOwner);
  const availableShortcuts = SIDEBAR_ITEMS.filter(
    (shortcut) => shortcut.id !== "maps" || mapsReleaseApproved,
  );
  const sidebarStyle = {
    ...sidebarColors(layout.color),
    "--sidebar-expanded": `${layout.width}px`,
  } as React.CSSProperties;
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

  const quickTogglePin = (conversation: Conversation) => {
    if (!onTogglePin) return;
    const context = chatActionContextRef.current;
    onTogglePin(conversation.id);
    // Moving between Recent and Pinned can remount the row. Restore keyboard
    // focus to the same chat's new quick-pin button only in the same sidebar.
    window.requestAnimationFrame(() => {
      if (context !== chatActionContextRef.current) return;
      const next = chatPinRefs.current.get(conversation.id);
      if (next?.isConnected) next.focus({ preventScroll: true });
    });
  };

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

  const connectionView = useRouterState({
    select: (state) => new URLSearchParams(state.location.searchStr).get("connection_view"),
  });
  const isOn = (path: string) => {
    const [base, query] = path.split("?");
    if (base === "/apps")
      return (
        pathname === base && connectionView === new URLSearchParams(query).get("connection_view")
      );
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  useEffect(() => {
    const refresh = () => {
      setRailPreferences({
        owner: railOwner,
        layout: readSidebarLayout(safeBrowserStorage("localStorage"), railOwner),
      });
      setRailSaveError("");
    };
    refresh();
    setRailDialogOwner(null);
    resizeRef.current = null;
    setResizing(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === sidebarLayoutKey(railOwner)) refresh();
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
  const changeLayout = (patch: Partial<SidebarLayout>) => {
    if (!railOwner) return;
    const next = { ...layout, ...patch };
    setRailPreferences({ owner: railOwner, layout: next });
    setRailSaveError(
      saveSidebarLayout(safeBrowserStorage("localStorage"), railOwner, next)
        ? ""
        : "Your choices apply now, but this browser could not save them. Try again to keep them after reload.",
    );
  };
  const changeRailShortcuts = (shortcuts: readonly SidebarShortcutId[]) =>
    changeLayout({ shortcuts: [...shortcuts] });
  const openChatSearch = (event?: { currentTarget: HTMLElement }) => {
    if (onOpenWorkspaceSearch) {
      cancelPendingSelection();
      onOpenWorkspaceSearch();
    } else {
      if (event?.currentTarget) searchReturnFocusRef.current = event.currentTarget;
      setSearchOpen((value) => !value);
    }
  };
  const searchButton = (rail = false) => {
    const button = (
      <button
        type="button"
        className={
          rail ? "kova-rail-button kova-header-search" : "kova-header-button kova-header-search"
        }
        aria-label="Search chats"
        aria-haspopup="dialog"
        aria-expanded={onOpenWorkspaceSearch ? workspaceSearchOpen : searchOpen}
        onClick={openChatSearch}
      >
        <SearchGlyph aria-hidden="true" />
      </button>
    );
    return rail ? <RailTooltip label="Search chats">{button}</RailTooltip> : button;
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
  useLayoutEffect(() => {
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
          'button, a, input, textarea, select, [role="button"], [role="link"], [role="slider"], [contenteditable]:not([contenteditable="false"])',
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
      if (
        event.touches.length !== 1 ||
        touch.identifier !== gesture.id ||
        !isMobileViewport() ||
        !window.getSelection()?.isCollapsed ||
        document.querySelector('[aria-modal="true"], dialog[open]')
      ) {
        reset();
        return;
      }
      const dx = touch.clientX - gesture.x;
      const dy = Math.abs(touch.clientY - gesture.y);
      if (event.timeStamp - gesture.time > 750 || dx > 24 || (dy > 24 && dy > Math.abs(dx))) {
        reset();
        return;
      }
      // Right-to-left opens, as requested; clear horizontal intent is required.
      if (isClearSidebarSwipe({ open: false, dx, dy, elapsedMs: event.timeStamp - gesture.time })) {
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

  // Close the mobile drawer with a deliberate right swipe, without stealing
  // vertical scrolling or horizontal gestures from nested scrollable controls.
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    let start: { id: number; x: number; y: number; time: number } | null = null;
    const onStart = (event: TouchEvent) => {
      start = null;
      if (
        !isMobileViewport() ||
        drawer.inert ||
        event.touches.length !== 1 ||
        !window.getSelection()?.isCollapsed
      )
        return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(
          'button:not(.kova-sidebar-scrim), a, input, textarea, select, [role="button"], [role="link"], [role="slider"], [contenteditable="true"]',
        )
      )
        return;
      for (let el: Element | null = target; el && el !== drawer; el = el.parentElement) {
        if (
          el.scrollWidth > el.clientWidth + 1 &&
          /^(auto|scroll)$/.test(getComputedStyle(el).overflowX)
        )
          return;
      }
      const t = event.touches[0];
      start = { id: t.identifier, x: t.clientX, y: t.clientY, time: event.timeStamp };
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      if (
        drawer.inert ||
        event.touches.length !== 1 ||
        !window.getSelection()?.isCollapsed ||
        event.timeStamp - start.time > 700
      ) {
        start = null;
        return;
      }
      const t = event.touches[0];
      if (t.identifier !== start.id) {
        start = null;
        return;
      }
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dy > 32 && dy > Math.abs(dx)) {
        start = null;
        return;
      }
      if (isClearSidebarSwipe({ open: true, dx, dy, elapsedMs: event.timeStamp - start.time })) {
        start = null;
        swipeToggleRef.current();
      }
    };
    const reset = () => {
      start = null;
    };
    drawer.addEventListener("touchstart", onStart, { passive: true });
    drawer.addEventListener("touchmove", onMove, { passive: true });
    drawer.addEventListener("touchend", reset);
    drawer.addEventListener("touchcancel", reset);
    return () => {
      drawer.removeEventListener("touchstart", onStart);
      drawer.removeEventListener("touchmove", onMove);
      drawer.removeEventListener("touchend", reset);
      drawer.removeEventListener("touchcancel", reset);
    };
  }, [open]);

  useEffect(() => {
    const openSearch = () => {
      if (onOpenWorkspaceSearch) {
        cancelPendingSelection();
        onOpenWorkspaceSearch();
        return;
      }
      if (searchDialogRef.current?.open) {
        searchInputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (document.querySelector('[aria-modal="true"]:not(.kova-sidebar), dialog[open]')) return;
      searchReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSearchOpen(true);
    };
    window.addEventListener("kova-open-search", openSearch);
    return () => window.removeEventListener("kova-open-search", openSearch);
  }, [onOpenWorkspaceSearch, cancelPendingSelection]);

  useEffect(() => {
    if (!open || !mobileViewport) return;
    navigationOwnsFocusRef.current = false;
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const content = drawerRef.current
      ?.closest(".kova-assistant, .kova-app-shell")
      ?.querySelector<HTMLElement>(".kova-chat-main, .kova-app-content, .spec400-images");
    const previousInert = content?.inert ?? false;
    if (content) content.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Opening motion can leave the close control unfocusable during this effect.
    // Wait for a visible commit and confirm focus actually moved; a later user
    // action or a closing drawer always cancels this bounded opening request.
    const drawer = drawerRef.current;
    const openingSource = lastFocusedRef.current;
    const focusDeadline = window.performance.now() + 500;
    let openingFocusFrame: number | null = null;
    let openingFocusCancelled = false;
    let openingFocusAttempts = 0;
    const cancelOpeningFocus = () => {
      openingFocusCancelled = true;
      if (openingFocusFrame !== null) window.cancelAnimationFrame(openingFocusFrame);
      openingFocusFrame = null;
    };
    const focusOpeningControl = () => {
      openingFocusFrame = null;
      if (
        openingFocusCancelled ||
        !drawer?.isConnected ||
        drawerRef.current !== drawer ||
        drawer.dataset.state !== "open" ||
        !isMobileViewport()
      )
        return;
      const active = document.activeElement;
      if (
        active !== document.body &&
        active !== document.documentElement &&
        active !== openingSource
      )
        return;
      const close = drawer.querySelector<HTMLButtonElement>('[aria-label="Close sidebar"]');
      openingFocusAttempts += 1;
      if (
        close?.isConnected &&
        !close.disabled &&
        !close.closest("[inert]") &&
        close.offsetParent !== null &&
        getComputedStyle(close).visibility === "visible"
      ) {
        close.focus({ preventScroll: true });
        if (document.activeElement === close) return;
      }
      if (openingFocusAttempts < 60 && window.performance.now() < focusDeadline)
        openingFocusFrame = window.requestAnimationFrame(focusOpeningControl);
    };
    const onOpeningFocusMoved = (event: FocusEvent) => {
      if (event.target === document.body || event.target === document.documentElement) return;
      cancelOpeningFocus();
    };
    document.addEventListener("pointerdown", cancelOpeningFocus, true);
    document.addEventListener("keydown", cancelOpeningFocus, true);
    document.addEventListener("focusin", onOpeningFocusMoved, true);
    openingFocusFrame = window.requestAnimationFrame(focusOpeningControl);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || drawerRef.current?.inert) return;
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
      const outsideDrawer = !drawerRef.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outsideDrawer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outsideDrawer)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelOpeningFocus();
      document.removeEventListener("pointerdown", cancelOpeningFocus, true);
      document.removeEventListener("keydown", cancelOpeningFocus, true);
      document.removeEventListener("focusin", onOpeningFocusMoved, true);
      document.body.style.overflow = previousOverflow;
      if (content) content.inert = previousInert;
      document.removeEventListener("keydown", onKeyDown);
      if (navigationOwnsFocusRef.current) return;
      requestAnimationFrame(() => {
        // A newly opened account dialog owns focus; do not pull it back underneath.
        if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
        const active = document.activeElement;
        if (
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          !drawer?.contains(active)
        )
          return;
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
      key={to}
      to={to.split("?")[0] as never}
      search={
        to.includes("?")
          ? (Object.fromEntries(new URLSearchParams(to.split("?")[1])) as never)
          : undefined
      }
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
        to={to.split("?")[0] as never}
        search={
          to.includes("?")
            ? (Object.fromEntries(new URLSearchParams(to.split("?")[1])) as never)
            : undefined
        }
        className="kova-rail-button relative"
        aria-label={label}
        aria-current={isOn(to) ? "page" : undefined}
      >
        <Icon aria-hidden="true" />
      </Link>
    </RailTooltip>
  );

  const query = localSearchOpen ? searchQuery.trim() : "";
  const savedConversations = signedIn
    ? conversations.filter((chat) => !pendingDeleteIds.has(chat.id))
    : [];
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
        aria-description={
          unreadReplyIds?.has(conversation.id) && activeId !== conversation.id
            ? "Unread reply"
            : undefined
        }
      >
        <span className="truncate">{conversation.title}</span>
        {unreadReplyIds?.has(conversation.id) && activeId !== conversation.id && (
          <span className="kova-chat-unread-dot" data-testid="chat-unread-dot" aria-hidden="true" />
        )}
      </button>
      {onTogglePin ? (
        <button
          type="button"
          className={`kova-chat-quick-pin${conversation.pinned ? " is-pinned" : ""}`}
          ref={(element) => {
            if (element) chatPinRefs.current.set(conversation.id, element);
            else chatPinRefs.current.delete(conversation.id);
          }}
          title={conversation.pinned ? "Unpin chat" : "Pin chat"}
          aria-label={`${conversation.pinned ? "Unpin" : "Pin"} ${conversation.title}`}
          aria-pressed={Boolean(conversation.pinned)}
          data-pinned={conversation.pinned ? "true" : "false"}
          onClick={(event) => {
            event.stopPropagation();
            quickTogglePin(conversation);
          }}
        >
          <Pin aria-hidden="true" fill={conversation.pinned ? "currentColor" : "none"} />
        </button>
      ) : null}
      <DropdownMenu modal={false}>
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
          side={mobileViewport ? "bottom" : "right"}
          align={mobileViewport ? "end" : "center"}
          sideOffset={mobileViewport ? 10 : 14}
          collisionPadding={12}
          className="kova-sidebar-chat-menu"
          data-sidebar-menu-placement="floating"
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
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {onTogglePin ? (
            <DropdownMenuItem onClick={(event) => beginPin(conversation, event.currentTarget)}>
              {conversation.pinned ? <PinOff /> : <Pin />}
              {conversation.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
          ) : null}
          {(onShare || onDuplicate) && <DropdownMenuSeparator />}
          {onShare ? (
            <DropdownMenuItem onClick={() => onShare(conversation.id)}>
              <Share2 />
              Share
            </DropdownMenuItem>
          ) : null}
          {onDuplicate ? (
            <DropdownMenuItem onClick={() => onDuplicate(conversation.id)}>
              <CopyIcon />
              Duplicate
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            disabled={!deleteReady}
            title={!deleteReady ? "Chat history is not ready to save changes yet." : undefined}
            onClick={() => onDelete(conversation.id)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
          {signedIn && user?.id ? (
            <>
              <DropdownMenuSeparator />
              <ChatProjectSubmenu
                ownerId={user.id}
                onSelect={(projectId) => {
                  cancelPendingSelection();
                  setProjectChoice(projectId);
                  setProjectChat(conversation);
                }}
              />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const { profile: accountProfile } = useAccountProfile(isLoaded ? (user?.id ?? null) : null);
  const accountName =
    accountProfile?.name || user?.fullName || user?.firstName || user?.username || null;
  const accountEmail = user?.email || null;
  const displayName = !isLoaded
    ? "Loading account…"
    : accountName || accountEmail || "Account details unavailable";
  const avatarUrl = isLoaded
    ? accountProfile?.photo === undefined
      ? user?.imageUrl
      : accountProfile.photo
    : null;
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

  const renderAccountMenu = (rail = false) => (
    <DropdownMenuContent
      side={rail ? "right" : "top"}
      align="end"
      className="kova-profile-menu"
      data-rail={rail}
    >
      <DropdownMenuLabel className="kova-profile-menu-account">
        <span className="kova-profile-menu-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : accountInitial || <UserRound size={20} />}
        </span>
        <span className="min-w-0">
          <strong className="block truncate">{displayName}</strong>
          <small className="block truncate text-foreground">{planLabel}</small>
          <small className="block truncate text-foreground">
            {accountEmail || "Email unavailable"}
          </small>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link
          to={tierStatus === "ready" && tier === "pro" ? "/pricing" : "/subscribe"}
          search={
            tier === "pro"
              ? undefined
              : ({ plan: tier === "plus" ? "pro_monthly" : "plus_monthly" } as never)
          }
          onClick={() => cancelPendingSelection()}
        >
          <Sparkles aria-hidden="true" />
          {tierStatus === "ready" && tier === "pro" ? "View plans" : "Upgrade plan"}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          cancelPendingSelection();
          onOpenSettings("general");
        }}
      >
        <CustomizeGlyph aria-hidden="true" />
        Personalization
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          cancelPendingSelection();
          onOpenSettings("personalization");
        }}
      >
        <UserRound aria-hidden="true" />
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          cancelPendingSelection();
          onOpenSettings("appearance");
        }}
      >
        <SettingsIcon aria-hidden="true" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          cancelPendingSelection();
          onOpenHelp();
        }}
      >
        <CircleHelp aria-hidden="true" />
        Help
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          cancelPendingSelection();
          setLogoutConfirmOpen(true);
        }}
      >
        <LogOut aria-hidden="true" />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <>
      {signedIn && (
        <LogoutConfirmDialog
          open={logoutConfirmOpen}
          onOpenChange={setLogoutConfirmOpen}
          onConfirm={() => clerk.signOut()}
        />
      )}
      {railDialogOpen ? (
        <dialog
          ref={railDialogRef}
          className="kova-sidebar-personalization"
          data-ui-reference="chatgpt-settings-dialog"
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
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Close sidebar customization"
              onClick={closeRailPersonalization}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <p id="sidebar-personalization-description">
            Make this space yours. Show the tools you use, choose a color, and adjust the width.
          </p>
          <fieldset>
            <legend>Navigation items</legend>
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
          <fieldset className="kova-sidebar-order">
            <legend>Item order</legend>
            {railShortcuts.map((id, index) => {
              const item = availableShortcuts.find((entry) => entry.id === id);
              if (!item) return null;
              return (
                <div key={id}>
                  <span>{item.label}</span>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...railShortcuts];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      changeRailShortcuts(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === railShortcuts.length - 1}
                    onClick={() => {
                      const next = [...railShortcuts];
                      [next[index + 1], next[index]] = [next[index], next[index + 1]];
                      changeRailShortcuts(next);
                    }}
                  >
                    ↓
                  </button>
                </div>
              );
            })}
          </fieldset>
          <fieldset className="kova-sidebar-layout-controls">
            <legend>Layout & appearance</legend>
            <label>
              Search chats
              <select
                aria-label="Search position"
                value={layout.searchPosition}
                onChange={(event) =>
                  changeLayout({
                    searchPosition: event.target.value as SidebarLayout["searchPosition"],
                  })
                }
              >
                <option value="header">Header icon</option>
                <option value="navigation">Navigation item</option>
              </select>
            </label>
            <label>
              Sidebar width <span>{layout.width}px</span>
              <input
                aria-label="Sidebar width"
                type="range"
                min={240}
                max={420}
                step={1}
                value={layout.width}
                onChange={(event) => changeLayout({ width: Number(event.target.value) })}
              />
            </label>
            <label>
              Sidebar color{" "}
              <input
                aria-label="Sidebar color"
                type="color"
                value={layout.color === "default" ? "#171717" : layout.color}
                onChange={(event) => changeLayout({ color: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="kova-sidebar-color-reset"
              onClick={() => changeLayout({ color: "default" })}
            >
              Use theme color
            </button>
            <label className="kova-sidebar-shortcut-choice">
              <span>New chat</span>
              <Switch
                aria-label="Show New chat"
                checked={layout.newChat}
                onCheckedChange={(newChat) => changeLayout({ newChat })}
              />
            </label>
            <label className="kova-sidebar-shortcut-choice">
              <span>Recent chats</span>
              <Switch
                aria-label="Show recent chats"
                checked={layout.recentChats}
                onCheckedChange={(recentChats) => changeLayout({ recentChats })}
              />
            </label>
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
            <Button
              variant="outline"
              type="button"
              onClick={() => changeLayout({ ...DEFAULT_SIDEBAR_LAYOUT })}
            >
              Reset to default
            </Button>
            <Button type="button" onClick={closeRailPersonalization}>
              Done
            </Button>
          </div>
        </dialog>
      ) : null}
      {projectChat ? (
        <Suspense fallback={null}>
          <ChatProjectDialog
            open
            conversation={projectChat}
            initialProjectId={projectChoice}
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
          data-ui-reference="chatgpt-rename-dialog"
          aria-labelledby="rename-chat-title"
          aria-modal="true"
          className="kova-rename-dialog"
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
                <Button
                  variant="outline"
                  ref={keepRenameRef}
                  type="button"
                  className="min-h-11 px-4"
                  onClick={keepRename}
                >
                  Keep editing
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  className="min-h-11 px-4"
                  onClick={closeRename}
                >
                  Discard changes
                </Button>
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
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="Close rename chat"
                disabled={renamePending}
                className="grid size-11 shrink-0 place-items-center"
                onClick={requestCloseRename}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <label className="mt-4 block text-sm" htmlFor="rename-chat-name">
              Keep it short and recognizable
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
              <Button
                variant="outline"
                type="button"
                disabled={renamePending}
                onClick={requestCloseRename}
                className="min-h-11 rounded-full px-4"
              >
                Cancel
              </Button>
              <Button
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
                  "Save"
                )}
              </Button>
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
        aria-hidden={!open || !mobileViewport || workspaceSearchOpen}
        disabled={!open || workspaceSearchOpen}
        tabIndex={-1}
      />

      {signedIn ? (
        <TooltipProvider>
          <nav
            className="kova-sidebar-rail"
            style={sidebarStyle}
            data-ui-reference="chatgpt-collapsed-sidebar"
            aria-label="Collapsed navigation"
            data-kova-core-rail=""
            data-kova-signed-in=""
            data-kova-refined-sidebar=""
            data-state={collapsed ? "open" : "closed"}
            aria-hidden={!collapsed || workspaceSearchOpen}
            inert={!collapsed || workspaceSearchOpen}
          >
            <div className="kova-rail-header">
              <RailTooltip label={compactOnly ? "Back to chat" : "Expand sidebar"}>
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
                  aria-label={compactOnly ? "Back to chat" : "Expand sidebar"}
                >
                  {compactOnly ? (
                    <ArrowLeft aria-hidden="true" />
                  ) : (
                    <PanelLeft aria-hidden="true" />
                  )}
                </button>
              </RailTooltip>
            </div>
            <div className="kova-rail-shortcuts">
              <div
                role="group"
                aria-label="Primary destinations"
                className="flex shrink-0 flex-col items-center gap-2"
              >
                {layout.newChat ? (
                  <RailTooltip label="New chat">
                    <button
                      type="button"
                      onClick={onNew}
                      className="kova-rail-button kova-new-chat"
                      aria-label="New chat"
                    >
                      <NewChatGlyph aria-hidden="true" />
                    </button>
                  </RailTooltip>
                ) : null}
                {railLink("/", "Chat", MessageSquare)}
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
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="kova-rail-account"
                  aria-label="Account menu"
                  title="Account menu"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">{accountInitial || <UserRound size={20} />}</span>
                  )}
                </button>
              </DropdownMenuTrigger>
              {renderAccountMenu(true)}
            </DropdownMenu>
          </nav>
        </TooltipProvider>
      ) : null}

      <aside
        ref={drawerRef}
        id="kova-primary-navigation"
        data-kova-core-sidebar=""
        data-kova-signed-in={signedIn ? "" : undefined}
        data-kova-refined-sidebar=""
        style={sidebarStyle}
        data-resizing={resizing || undefined}
        className="kova-sidebar"
        data-ui-reference="chatgpt-sidebar"
        aria-label="Primary navigation"
        data-state={open ? "open" : "closed"}
        aria-modal={open && mobileViewport && !workspaceSearchOpen ? true : undefined}
        aria-hidden={collapsed || workspaceSearchOpen ? true : undefined}
        inert={collapsed || workspaceSearchOpen ? true : undefined}
        role={open && mobileViewport ? "dialog" : "navigation"}
      >
        <div className="kova-sidebar-inner">
          <header className="kova-sidebar-header">
            <span className="kova-sidebar-brand flex items-center gap-2">
              <NovaLogo decorative className="h-6 w-6" />
              KovaGPT
            </span>
            <div className="kova-sidebar-header-actions">
              {layout.searchPosition === "header" ? searchButton() : null}
              <button
                type="button"
                className="kova-header-button kova-sidebar-toggle flex lg:hidden"
                onClick={onToggle}
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <PanelLeft aria-hidden="true" />
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
                <PanelLeft aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="kova-sidebar-scroll">
            <nav className="kova-sidebar-primary" aria-label="KovaGPT features">
              {layout.newChat ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelPendingSelection();
                    closeAfterMobileNavigation("/");
                    onNew();
                  }}
                  className="kova-new-chat kova-nav-row"
                  aria-label="New chat"
                >
                  {icon(NewChatGlyph)}
                  <span>New chat</span>
                </button>
              ) : null}
              {layout.searchPosition === "navigation" ? (
                <button
                  type="button"
                  className="kova-nav-row"
                  aria-label="Search chats"
                  aria-haspopup="dialog"
                  aria-expanded={workspaceSearchOpen}
                  onClick={(event) => {
                    if (onOpenWorkspaceSearch) {
                      cancelPendingSelection();
                      onOpenWorkspaceSearch();
                    } else {
                      searchReturnFocusRef.current = event.currentTarget;
                      setSearchOpen((value) => !value);
                    }
                  }}
                >
                  <span className="kova-sidebar-icon" aria-hidden="true">
                    <SearchGlyph />
                  </span>
                  <span>Search</span>
                </button>
              ) : null}
              {railShortcuts
                .filter((id) => !["discovery", "maps"].includes(id))
                .map((id) => {
                  const item = availableShortcuts.find((entry) => entry.id === id);
                  return item ? navLink(item.to, item.label, SHORTCUT_ICONS[id]) : null;
                })}
              <details
                className="kova-sidebar-more-disclosure"
                data-ui-reference="gemini-sidebar-disclosure"
                open={isOn("/maps") || undefined}
              >
                <summary className="kova-nav-row cursor-pointer">
                  {icon(MoreGlyph)}
                  <span>More</span>
                </summary>
                {mapsReleaseApproved && railShortcuts.includes("maps")
                  ? navLink("/maps", "Maps", Map)
                  : null}
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
            <section
              className="kova-sidebar-history"
              aria-label="Chats"
              hidden={!layout.recentChats}
            >
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
                  onClick={(event) => {
                    if (onOpenWorkspaceSearch) onOpenWorkspaceSearch();
                    else {
                      searchReturnFocusRef.current = event.currentTarget;
                      setSearchOpen(true);
                    }
                  }}
                >
                  View all chats
                </button>
              ) : null}
              {savedConversations.length === 0 ? (
                <p className="kova-sidebar-empty">
                  {!isLoaded
                    ? "Loading chats…"
                    : signedIn
                      ? "No saved chats yet."
                      : "Log in to view saved chats."}
                </p>
              ) : null}
              {query && savedConversations.length > 0 && filtered.length === 0 ? (
                <p className="kova-sidebar-empty">No matches</p>
              ) : null}
            </section>
          </div>

          <footer className="kova-sidebar-footer">
            {signedIn ? (
              <>
                <DropdownMenu modal={false}>
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
                  {renderAccountMenu()}
                </DropdownMenu>
              </>
            ) : isLoaded ? (
              <div className="w-full">
                <nav className="kova-guest-account-options" aria-label="Account options">
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
                {!hideGuestLogin ? (
                  <div className="flex items-center gap-2">
                    <SignInButton mode="modal">
                      <button type="button" className="kova-sign-in min-w-0 flex-1">
                        Log in
                      </button>
                    </SignInButton>
                  </div>
                ) : null}
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                Loading account…
              </p>
            )}
          </footer>
        </div>
        {!mobileViewport ? (
          <div
            className="kova-sidebar-resize"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={420}
            aria-valuenow={layout.width}
            tabIndex={open ? 0 : -1}
            title="Drag to resize · Arrow keys to adjust · Double-click to reset"
            onDoubleClick={() => changeLayout({ width: DEFAULT_SIDEBAR_LAYOUT.width })}
            onKeyDown={(event) => {
              const width =
                event.key === "ArrowLeft"
                  ? layout.width - 10
                  : event.key === "ArrowRight"
                    ? layout.width + 10
                    : event.key === "Home"
                      ? 240
                      : event.key === "End"
                        ? 420
                        : null;
              if (width === null) return;
              event.preventDefault();
              changeLayout({ width: clampSidebarWidth(width) });
            }}
            onPointerDown={(event) => {
              if (!railOwner || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeRef.current = {
                owner: railOwner,
                x: event.clientX,
                width: layout.width,
                draft: layout.width,
                layout,
              };
              setResizing(true);
            }}
            onPointerMove={(event) => {
              const drag = resizeRef.current;
              if (!drag || drag.owner !== accountRef.current) return;
              drag.draft = clampSidebarWidth(drag.width + event.clientX - drag.x);
              setRailPreferences({
                owner: drag.owner,
                layout: { ...drag.layout, width: drag.draft },
              });
            }}
            onLostPointerCapture={() => {
              const drag = resizeRef.current;
              resizeRef.current = null;
              setResizing(false);
              if (!drag || drag.owner !== accountRef.current) return;
              const next = { ...drag.layout, width: drag.draft };
              setRailSaveError(
                saveSidebarLayout(safeBrowserStorage("localStorage"), drag.owner, next)
                  ? ""
                  : "This width could not be saved. Try again in Customize sidebar.",
              );
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            <span />
          </div>
        ) : null}
      </aside>
      {localSearchOpen ? (
        <dialog
          ref={searchDialogRef}
          aria-label="Search chats"
          aria-modal="true"
          aria-describedby="sidebar-chat-search-description"
          className="pointer-events-auto m-auto overflow-hidden rounded-[var(--kova-radius-panel)] border-0 bg-popover p-0 text-popover-foreground shadow-2xl backdrop:bg-black/45"
          style={{
            width: "min(36rem, calc(100vw - 2rem))",
            maxHeight:
              "min(80dvh, calc(100dvh - max(1rem, var(--safe-top)) - max(1rem, var(--safe-bottom))))",
          }}
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeChatSearch();
          }}
          onCancel={(event) => {
            event.preventDefault();
            closeChatSearch();
          }}
          onClose={closeChatSearch}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              closeChatSearch();
          }}
        >
          <div className="flex min-h-0 max-h-[inherit] flex-col p-5">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Search chats</h2>
              <button
                type="button"
                aria-label="Close chat search"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-accent"
                onClick={closeChatSearch}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p
              id="sidebar-chat-search-description"
              className="shrink-0 text-sm text-muted-foreground"
            >
              Find a saved chat by title or message.
            </p>
            <label className="sr-only" htmlFor="sidebar-chat-search">
              Search chats
            </label>
            <input
              id="sidebar-chat-search"
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search chats"
              className="kova-sidebar-search my-4 w-full shrink-0"
            />
            <div
              className="min-h-0 overflow-y-auto overscroll-contain"
              style={{ maxHeight: "min(24rem, 50dvh)" }}
            >
              {!isLoaded ? (
                <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
                  Loading chat history…
                </p>
              ) : !signedIn ? (
                <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
                  Log in to search saved chats.
                </p>
              ) : filtered.length === 0 ? (
                <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
                  No chats found.
                </p>
              ) : (
                <ul aria-label="Chat search results" className="space-y-1">
                  {filtered.map((conversation) => (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        aria-label={`Open chat ${conversation.title}`}
                        className="min-h-11 w-full break-words rounded-xl px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          closeChatSearch();
                          cancelPendingSelection();
                          onSelect(conversation.id);
                        }}
                      >
                        {conversation.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </dialog>
      ) : null}
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
