import {
  Archive,
  CircleHelp,
  Clock3,
  Copy as CopyIcon,
  CreditCard,
  Ellipsis,
  Folder,
  Images,
  LibraryBig,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Share2,
  ShoppingBag,
  SquarePen,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { NovaLogo } from "@/components/NovaLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTier } from "@/hooks/useTier";
import type { Conversation } from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";

const EXPANDED_WIDTH = 272;

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
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
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onShare?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onArchive?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenHelp: () => void;
  mapsReleaseApproved?: boolean;
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const { tier } = useTier();
  const drawerRef = useRef<HTMLElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renameChat, setRenameChat] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const signedIn = isLoaded && isSignedIn;
  const collapsed = !open;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isOn = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

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
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
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
    if (!open || !isMobileViewport()) return;
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onToggle();
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
      document.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [open, onToggle]);

  const closeAfterMobileNavigation = () => {
    if (open && isMobileViewport()) onToggle();
  };
  const navRow = (active = false) => `kova-nav-row ${active ? "is-active" : ""}`;
  const icon = (Icon: LucideIcon) => (
    <span className="kova-sidebar-icon" aria-hidden="true">
      <Icon />
    </span>
  );
  const navLink = (to: string, label: string, Icon: LucideIcon, badge?: string) => (
    <Link
      to={to as never}
      className={navRow(isOn(to))}
      aria-current={isOn(to) ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={closeAfterMobileNavigation}
    >
      {icon(Icon)}
      <span className="kova-sidebar-label">{label}</span>
      {badge ? <span className="kova-sidebar-badge">{badge}</span> : null}
    </Link>
  );

  const query = searchQuery.trim();
  const filtered = query
    ? searchConversations(conversations, query).map((result) => result.conversation)
    : conversations;
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
        onClick={() => {
          onSelect(conversation.id);
          closeAfterMobileNavigation();
        }}
        aria-label={`Open chat ${conversation.title}`}
        aria-current={activeId === conversation.id ? "page" : undefined}
        title={conversation.title}
      >
        {conversation.pinned ? icon(MessageCircle) : null}
        <span className="truncate">{conversation.title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="kova-chat-options"
            aria-label={`Options for ${conversation.title}`}
          >
            <Ellipsis aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onRename ? (
            <DropdownMenuItem
              onClick={() => {
                setRenameChat(conversation);
                setRenameTitle(conversation.title);
              }}
            >
              Rename
            </DropdownMenuItem>
          ) : null}
          {onTogglePin ? (
            <DropdownMenuItem onClick={() => onTogglePin(conversation.id)}>
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
          {onArchive ? (
            <DropdownMenuItem onClick={() => onArchive(conversation.id)}>
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

  const displayName =
    user?.fullName || user?.firstName || user?.username || user?.email?.split("@")[0] || "Account";
  const avatarUrl = user?.imageUrl || null;
  const planLabel = tier === "pro" ? "Pro" : tier === "plus" ? "Plus" : "Free";

  return (
    <>
      {renameChat ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-chat-title"
          className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4"
        >
          <form
            className="w-full max-w-sm rounded-xl border bg-background p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const title = renameTitle.trim();
              if (title) onRename?.(renameChat.id, title);
              setRenameChat(null);
            }}
          >
            <h2 id="rename-chat-title" className="font-semibold">
              Rename chat
            </h2>
            <input
              autoFocus
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              className="mt-3 min-h-11 w-full rounded-md border bg-background px-3"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameChat(null)}
                className="min-h-11 rounded-md px-3"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-11 rounded-md bg-foreground px-3 text-background"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {open ? (
        <button
          type="button"
          onClick={onToggle}
          className="kova-sidebar-scrim fixed inset-0 z-30 bg-black/45 lg:hidden"
          aria-label="Close navigation menu"
        />
      ) : null}

      {collapsed && signedIn ? (
        <nav
          className="kova-sidebar-rail hidden h-[100dvh] w-[64px] shrink-0 flex-col items-center bg-sidebar lg:flex"
          aria-label="Collapsed navigation"
        >
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
            title="Expand sidebar"
          >
            <PanelLeftOpen />
          </button>
          <button
            type="button"
            onClick={onNew}
            className="kova-rail-button kova-new-chat"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen />
          </button>
          <Link to="/images" className="kova-rail-button" aria-label="Images" title="Images">
            <Images />
          </Link>
          <Link to="/library" className="kova-rail-button" aria-label="Library" title="Library">
            <LibraryBig />
          </Link>
          <Link to="/projects" className="kova-rail-button" aria-label="Projects" title="Projects">
            <Folder />
          </Link>
          {signedIn ? (
            <Link
              to="/scheduled-tasks"
              className="kova-rail-button"
              aria-label="Scheduled tasks"
              title="Scheduled tasks"
            >
              <Clock3 />
            </Link>
          ) : null}
          <Link
            to="/apps"
            className="kova-rail-button"
            aria-label="Connections"
            title="Connections"
          >
            <Puzzle />
          </Link>
          <button
            type="button"
            className="kova-rail-account"
            onClick={() => onOpenSettings("general")}
            aria-label="Settings"
            title={`${displayName} · ${planLabel}`}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <span aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>
            )}
          </button>
        </nav>
      ) : null}

      <aside
        ref={drawerRef}
        style={{ "--sidebar-expanded": `${EXPANDED_WIDTH}px` } as React.CSSProperties}
        className={`kova-sidebar relative z-40 flex h-[100dvh] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 lg:w-[var(--sidebar-expanded)] ${collapsed ? "lg:!w-0" : ""} max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[min(88vw,320px)] ${open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"}`}
        aria-label="Primary navigation"
        data-state={open ? "open" : "closed"}
        aria-modal={open && isMobileViewport() ? true : undefined}
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed ? true : undefined}
        role={open && isMobileViewport() ? "dialog" : "navigation"}
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
                <Search />
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
                <PanelLeftClose />
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
                  onNew();
                  closeAfterMobileNavigation();
                }}
                className={`kova-new-chat ${isOn("/") && pathname === "/" ? "is-active" : ""}`}
              >
                {icon(SquarePen)}
                <span>New chat</span>
              </button>
              {navLink("/images", "Images", Images)}
              {navLink("/library", "Library", LibraryBig)}
              {navLink("/projects", "Projects", Folder)}
              {signedIn ? navLink("/scheduled-tasks", "Scheduled tasks", Clock3) : null}
              {navLink("/apps", "Connections", Puzzle)}
            </nav>

            <section className="kova-sidebar-history" aria-label="Chats">
              <h2>Chats</h2>
              {pinned.map(chatRow)}
              {recents.map(chatRow)}
              {conversations.length === 0 ? (
                <p className="kova-sidebar-empty">
                  No saved chats here.
                  {isLoaded && !signedIn ? (
                    <span className="mt-1 block">Log in to view saved chats.</span>
                  ) : null}
                </p>
              ) : null}
              {query && conversations.length > 0 && filtered.length === 0 ? (
                <p className="kova-sidebar-empty">No matches</p>
              ) : null}
            </section>
          </div>

          <footer className="kova-sidebar-footer">
            {signedIn ? (
              <>
                <button
                  type="button"
                  className="kova-account-main"
                  onClick={() => onOpenSettings("general")}
                  aria-label="Settings"
                >
                  <span className="kova-account-avatar">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" />
                    ) : (
                      displayName.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="kova-account-copy">
                    <strong>{displayName}</strong>
                    <small>{planLabel}</small>
                  </span>
                </button>
                <Link
                  to="/pricing"
                  className="kova-account-action"
                  aria-label="View plans and account options"
                  title="View plans"
                >
                  <ShoppingBag />
                </Link>
              </>
            ) : isLoaded ? (
              <div className="w-full">
                <nav className="kova-guest-account-options" aria-label="Account options">
                  {navLink("/pricing", "Subscriptions", CreditCard)}
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
                    {icon(SettingsIcon)}
                    <span>Settings</span>
                  </button>
                </nav>
                <p className="mb-3 text-sm font-semibold">Get responses tailored to you</p>
                <div className="flex items-center gap-2">
                  <SignInButton mode="modal">
                    <button type="button" className="kova-sign-in min-w-0 flex-1">
                      Log in to KovaGPT
                    </button>
                  </SignInButton>
                </div>
              </div>
            ) : null}
          </footer>
        </div>
      </aside>
    </>
  );
}
