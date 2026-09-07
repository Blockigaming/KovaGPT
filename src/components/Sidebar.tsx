import {
  Archive,
  ArrowUpRight,
  ChevronRight,
  Calendar,
  Copy as CopyIcon,
  CreditCard,
  FolderKanban,
  FolderOpen,
  Globe,
  HelpCircle,
  ImageIcon,
  LifeBuoy,
  Blocks,
  MoreHorizontal,
  PanelLeft,
  Pin,
  PinOff,
  Search,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Telescope,
  SquarePen,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SignInButton, SignUpButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NovaLogo } from "@/components/NovaLogo";
import { useTier } from "@/hooks/useTier";
import type { Conversation } from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";

const EXPANDED_WIDTH = 260;

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
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const { tier } = useTier();
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renameChat, setRenameChat] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const showSignedIn = isLoaded && isSignedIn;
  const showSignedOut = isLoaded && !isSignedIn;
  const collapsed = !open;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOn = (p: string) => pathname === p;

  useEffect(() => {
    const openSearch = () => {
      setSearchOpen(true);
      if (!open) onToggle();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>("#sidebar-chat-search")?.focus();
        });
      });
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

    const focusable = drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

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
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
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
      lastFocusedRef.current?.focus?.();
    };
  }, [open, onToggle]);

  const closeAfterMobileNavigation = () => {
    if (open && isMobileViewport()) onToggle();
  };

  const labelClass = collapsed ? "sr-only lg:sr-only" : "truncate";
  const iconOnly = collapsed ? "justify-center px-0" : "gap-2.5 px-3";
  const navItemClass = (active: boolean) =>
    `kova-nav-row relative flex h-10 items-center rounded-xl py-1 text-sm transition-colors duration-100 ${iconOnly} ${
      active
        ? "bg-sidebar-active text-foreground font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-hover"
    }`;

  const renderNavLink = (
    to: string,
    title: string,
    Icon: LucideIcon,
    active = isOn(to),
    badge?: string,
  ) => (
    <Link
      to={to as never}
      className={navItemClass(active)}
      title={title}
      aria-label={collapsed ? title : undefined}
      aria-current={active ? "page" : undefined}
      onClick={closeAfterMobileNavigation}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className={labelClass}>{title}</span>
      {badge && !collapsed ? (
        <span className="ml-auto rounded-full bg-sidebar-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  );

  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? searchConversations(conversations, searchQuery).map((result) => result.conversation)
    : conversations;
  const pinned = filtered
    .filter((c) => c.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const recents = filtered.filter((c) => !c.pinned).sort((a, b) => b.updatedAt - a.updatedAt);

  const renderRow = (c: Conversation) => (
    <div
      key={c.id}
      className={`kova-chat-row group relative mx-2 flex min-h-10 items-center gap-1 rounded-xl px-1.5 text-sm transition-colors duration-100 ${
        activeId === c.id ? "bg-sidebar-active" : "hover:bg-sidebar-hover/60"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          onSelect(c.id);
          closeAfterMobileNavigation();
        }}
        aria-label={`Open chat ${c.title}`}
        aria-current={activeId === c.id ? "page" : undefined}
        title={c.title}
      >
        {c.pinned ? <Pin className="h-3 w-3 shrink-0 fill-current text-muted-foreground" /> : null}
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
      </button>
      {!collapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 opacity-100 transition hover:bg-background/40 focus-visible:ring-2 focus-visible:ring-ring lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:data-[state=open]:opacity-100"
              aria-label="Chat options"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
            {onRename ? (
              <DropdownMenuItem
                aria-label={`Rename ${c.title}`}
                onClick={() => {
                  setRenameChat(c);
                  setRenameTitle(c.title);
                }}
              >
                Rename
              </DropdownMenuItem>
            ) : null}
            {onTogglePin ? (
              <DropdownMenuItem onClick={() => onTogglePin(c.id)}>
                {c.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                {c.pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
            ) : null}
            {onShare ? (
              <DropdownMenuItem onClick={() => onShare(c.id)}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </DropdownMenuItem>
            ) : null}
            {onDuplicate ? (
              <DropdownMenuItem onClick={() => onDuplicate(c.id)}>
                <CopyIcon className="mr-2 h-4 w-4" /> Duplicate
              </DropdownMenuItem>
            ) : null}
            {onArchive ? (
              <DropdownMenuItem onClick={() => onArchive(c.id)}>
                <Archive className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(c.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

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
          className="kova-sidebar-scrim fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] lg:hidden"
          aria-label="Close navigation menu"
        />
      ) : null}

      {collapsed && showSignedIn ? (
        <div
          className="kova-sidebar-rail hidden h-[100dvh] w-[56px] shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-sidebar pb-[max(.625rem,var(--safe-bottom))] pt-[max(.5rem,var(--safe-top))] lg:flex"
          aria-label="Collapsed navigation"
        >
          <button
            type="button"
            onClick={onToggle}
            className="mb-1 flex h-10 w-10 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <NovaLogo decorative mark className="h-[22px] w-[22px] text-foreground" />
          </button>
          <button
            type="button"
            onClick={onNew}
            className="kova-new-chat flex h-10 w-10 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("kova-open-search"))}
            className="flex h-10 w-10 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search chats"
            title="Search chats"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <Link
            to="/images"
            className="flex h-10 w-10 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-hover"
            aria-label="Images"
            title="Images"
          >
            <ImageIcon className="h-[18px] w-[18px]" />
          </Link>
          <div className="mt-auto flex flex-col items-center gap-1">
            <div onClick={(e) => e.stopPropagation()}>
              <UserButton />
            </div>
          </div>
        </div>
      ) : null}

      <aside
        ref={drawerRef}
        style={
          {
            "--sidebar-expanded": `${EXPANDED_WIDTH}px`,
          } as React.CSSProperties
        }
        className={`kova-sidebar relative z-40 flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-[var(--ease-spring)] lg:w-[var(--sidebar-expanded)] ${
          collapsed ? "lg:!w-0 lg:border-r-0" : ""
        } max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[min(88vw,320px)] max-lg:shadow-lg ${
          open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
        }`}
        aria-label="Primary navigation"
        aria-modal={open && isMobileViewport() ? true : undefined}
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed ? true : undefined}
        role={open && isMobileViewport() ? "dialog" : "navigation"}
      >
        <div className="kova-sidebar-inner flex h-full min-w-[var(--sidebar-expanded)] flex-col overflow-hidden">
          <div className="kova-sidebar-header relative z-20 flex min-h-[56px] items-center gap-1 bg-sidebar px-3 pt-[var(--safe-top)]">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
              <NovaLogo decorative mark className="h-6 w-6 text-foreground" />
              <span className="truncate text-base font-semibold tracking-tight">KovaGPT</span>
            </div>

            {showSignedOut ? (
              <button
                type="button"
                onClick={() => setSearchOpen((v) => !v)}
                className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring lg:flex"
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
            ) : null}

            <button
              onClick={onToggle}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              aria-label="Close navigation"
              title="Close navigation"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={() => {
                onToggle();
                window.requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLElement>('[aria-label="Open sidebar"]')
                    ?.focus({ preventScroll: true });
                });
              }}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring lg:flex"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeft className="h-[17px] w-[17px]" />
            </button>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-border"
          />

          {searchOpen && !collapsed ? (
            <div className="px-3 pb-1 pt-2">
              <label className="sr-only" htmlFor="sidebar-chat-search">
                Search chats
              </label>
              <input
                id="sidebar-chat-search"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, messages, or operators…"
                className="kova-sidebar-search h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition focus:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ) : null}

          <div className="kova-sidebar-primary flex flex-col gap-0.5 px-2 pt-2">
            <button
              onClick={() => {
                onNew();
                closeAfterMobileNavigation();
              }}
              className={navItemClass(isOn("/"))}
              aria-label="New chat"
              title="New chat"
            >
              <SquarePen className="h-[18px] w-[18px] shrink-0" />
              <span className={labelClass}>New chat</span>
            </button>

            {showSignedIn ? (
              <button
                type="button"
                onClick={() => setSearchOpen((v) => !v)}
                className={navItemClass(false)}
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="h-[18px] w-[18px] shrink-0" />
                <span className={labelClass}>Search</span>
              </button>
            ) : null}
            {showSignedIn ? renderNavLink("/projects", "Projects", FolderKanban) : null}
            {showSignedIn ? renderNavLink("/library", "Library", FolderOpen) : null}
            {showSignedIn ? renderNavLink("/kovas", "Kovas", Blocks) : null}
            {showSignedIn ? renderNavLink("/sites", "Sites", Globe) : null}
            {renderNavLink("/images", "Images", ImageIcon)}
            {renderNavLink("/apps", "Plugins", Blocks)}
            {renderNavLink("/research-planner", "Deep research", Telescope)}
            {renderNavLink("/discovery", "Discover", Globe, isOn("/discovery"))}

            {showSignedIn && (tier === "plus" || tier === "pro")
              ? renderNavLink(
                  "/scheduled-tasks",
                  "Scheduled tasks status",
                  Calendar,
                  isOn("/scheduled-tasks"),
                )
              : null}
            {showSignedIn && tier !== "plus" && tier !== "pro"
              ? renderNavLink("/pricing", "Subscriptions", CreditCard, isOn("/pricing"))
              : null}
          </div>

          <div
            className="kova-sidebar-history relative mt-2 min-h-0 flex-1 overflow-y-auto pb-4"
            role="group"
            aria-label="Chats"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none sticky top-0 z-10 h-4 bg-gradient-to-b from-sidebar to-transparent"
            />
            {!collapsed && showSignedIn ? (
              <>
                {!isLoaded && conversations.length === 0 ? (
                  <div className="space-y-2 px-3 pt-4" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="mx-2 h-8 rounded-lg bg-sidebar-hover/50 animate-pulse"
                        style={{ opacity: 1 - i * 0.15 }}
                      />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-5 py-3 text-sm text-muted-foreground">
                    {q ? "No matches" : "No chats yet"}
                  </div>
                ) : (
                  <>
                    {pinned.length > 0 ? (
                      <>
                        <div className="flex items-center gap-1.5 px-5 pb-1.5 pt-4 text-[13px] font-medium text-muted-foreground">
                          <Pin className="h-3 w-3" /> Pinned
                        </div>
                        {pinned.map(renderRow)}
                      </>
                    ) : null}
                    <div className="px-5 pb-1.5 pt-4 text-[13px] font-medium text-muted-foreground">
                      Recent chats
                    </div>
                    {recents.length === 0 ? (
                      <div className="px-5 py-2 text-sm text-muted-foreground">No recent chats</div>
                    ) : (
                      recents.map(renderRow)
                    )}
                  </>
                )}
              </>
            ) : collapsed ? (
              <div
                className="px-2 pt-3 text-center text-xs text-muted-foreground"
                aria-hidden="true"
              >
                •••
              </div>
            ) : null}
            <div
              aria-hidden="true"
              className="pointer-events-none sticky bottom-0 z-10 h-8 bg-gradient-to-t from-sidebar to-transparent"
            />
          </div>

          <div
            className={`kova-sidebar-footer mt-auto border-t border-border/60 bg-sidebar p-2.5 pb-[max(.625rem,var(--safe-bottom))] ${collapsed ? "lg:px-2" : ""}`}
          >
            {!isLoaded ? null : showSignedIn ? (
              <div className={`flex items-center gap-2 ${collapsed ? "lg:flex-col" : ""}`}>
                <button
                  onClick={() => {
                    onOpenSettings("general");
                    closeAfterMobileNavigation();
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Settings"
                  title="Settings"
                >
                  <SettingsIcon className="h-[18px] w-[18px]" />
                </button>
                <button
                  onClick={() => {
                    onOpenHelp();
                    closeAfterMobileNavigation();
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Help"
                  title="Help"
                >
                  <HelpCircle className="h-[18px] w-[18px]" />
                </button>
                <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                  <UserButton />
                </div>
                {!collapsed ? (
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {user?.firstName || "Account"}
                  </span>
                ) : null}
              </div>
            ) : showSignedOut ? (
              <div className={collapsed ? "" : "-mx-2.5 -mb-2.5"}>
                <div className={`flex flex-col gap-0.5 ${collapsed ? "" : "px-2 pb-2"}`}>
                  <Link
                    to="/pricing"
                    className={navItemClass(isOn("/pricing"))}
                    aria-label="See plans and pricing"
                    title="See plans and pricing"
                    onClick={closeAfterMobileNavigation}
                  >
                    <Sparkles className="h-[18px] w-[18px] shrink-0" />
                    <span className={labelClass}>See plans and pricing</span>
                    {!collapsed ? (
                      <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </Link>
                  <button
                    onClick={() => {
                      onOpenSettings("general");
                      closeAfterMobileNavigation();
                    }}
                    className={navItemClass(false)}
                    aria-label="Settings"
                    title="Settings"
                  >
                    <SettingsIcon className="h-[18px] w-[18px] shrink-0" />
                    <span className={labelClass}>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      onOpenHelp();
                      closeAfterMobileNavigation();
                    }}
                    className={navItemClass(false)}
                    aria-label="Help"
                    title="Help"
                  >
                    <LifeBuoy className="h-[18px] w-[18px] shrink-0" />
                    <span className={labelClass}>Help</span>
                    {!collapsed ? (
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                </div>
                {!collapsed ? (
                  <div className="kova-sidebar-auth-card mx-1 rounded-2xl border border-border/70 px-4 pb-4 pt-4">
                    <p className="text-[15px] font-semibold text-foreground">
                      Get responses tailored to you
                    </p>
                    <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                      Log in to get answers based on saved chats, plus create images and use
                      advanced models.
                    </p>
                    <SignInButton mode="modal">
                      <button className="kova-sidebar-auth-button mt-4 flex min-h-11 w-full items-center justify-center rounded-full border border-transparent bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90">
                        Log in
                      </button>
                    </SignInButton>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
