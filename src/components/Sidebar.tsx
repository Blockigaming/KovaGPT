import {
  Archive,
  Boxes,
  Brain,
  BriefcaseBusiness,
  Calendar,
  Clock3,
  Copy as CopyIcon,
  CreditCard,
  FolderKanban,
  FolderOpen,
  Files,
  FlaskConical,
  HelpCircle,
  ImageIcon,
  MoreHorizontal,
  Network,
  PanelLeft,
  Pin,
  PinOff,
  Plug,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Share2,
  SquarePen,
  Trash2,
  Users,
  Orbit,
  type LucideIcon,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SignInButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
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

const EXPANDED_WIDTH = 280;
const COLLAPSED_WIDTH = 72;
const MOBILE_DRAWER_WIDTH = "min(88vw, 340px)";

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onShare,
  onDuplicate,
  onArchive,
  onTogglePin,
  onAddMembers,
  open,
  onToggle,
  onOpenSettings,
  onOpenHelp,
  onOpenArchived,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onShare?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onArchive?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onAddMembers?: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenHelp: () => void;
  onOpenArchived?: () => void;
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const { tier } = useTier();
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const showSignedIn = isLoaded && isSignedIn;
  const showSignedOut = isLoaded && !isSignedIn;
  const collapsed = !open;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOn = (p: string) => pathname === p;

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
  const iconOnly = collapsed ? "justify-center px-0" : "gap-3 px-2.5";
  const navItemClass = (active: boolean) =>
    `relative flex min-h-11 items-center rounded-xl py-2 text-[14px] transition-colors duration-150 active:scale-[0.99] ${iconOnly} ${
      active
        ? "bg-sidebar-active text-foreground font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-hover"
    }`;
  const ActiveBar = ({ on }: { on: boolean }) =>
    on ? (
      <span
        aria-hidden="true"
        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-foreground/50"
      />
    ) : null;

  const renderNavLink = (to: string, title: string, Icon: LucideIcon, active = isOn(to)) => (
    <Link
      to={to as never}
      className={navItemClass(active)}
      title={title}
      aria-label={collapsed ? title : undefined}
      onClick={closeAfterMobileNavigation}
    >
      <ActiveBar on={active} />
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className={labelClass}>{title}</span>
    </Link>
  );

  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? searchConversations(conversations, searchQuery).map((result) => result.conversation)
    : conversations;
  const pinned = filtered
    .filter((c) => c.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const recents = filtered.filter((c) => !c.pinned);

  const renderRow = (c: Conversation) => (
    <div
      key={c.id}
      className={`group mx-2 my-0.5 flex min-h-10 cursor-pointer items-center gap-1 rounded-xl px-3 py-2 text-[14px] transition ${
        activeId === c.id ? "bg-sidebar-hover" : "hover:bg-sidebar-hover/60"
      } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
      onClick={() => {
        onSelect(c.id);
        closeAfterMobileNavigation();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open chat ${c.title}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(c.id);
          closeAfterMobileNavigation();
        }
      }}
      title={c.title}
    >
      {c.pinned ? (
        <Pin className="mr-1 h-3 w-3 shrink-0 fill-current text-muted-foreground" />
      ) : null}
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{c.title}</span>
      {!collapsed && onTogglePin ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(c.id);
          }}
          className={`rounded p-1 transition hover:bg-background/40 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
            c.pinned
              ? "opacity-100"
              : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
          }`}
          aria-label={c.pinned ? "Unpin chat" : "Pin chat"}
          title={c.pinned ? "Unpin chat" : "Pin chat"}
        >
          {c.pinned ? (
            <PinOff className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Pin className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      ) : null}
      {!collapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 opacity-100 transition hover:bg-background/40 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring lg:opacity-70 lg:hover:opacity-100 lg:group-focus-within:opacity-100 lg:data-[state=open]:opacity-100"
              aria-label="Chat options"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
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
            {showSignedIn && onAddMembers ? (
              <DropdownMenuItem onClick={() => onAddMembers(c.id)}>
                <Users className="mr-2 h-4 w-4" /> Add members
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
      {open ? (
        <button
          type="button"
          onClick={onToggle}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden"
          aria-label="Close navigation menu"
        />
      ) : null}

      <aside
        ref={drawerRef}
        style={
          {
            "--sidebar-expanded": `${EXPANDED_WIDTH}px`,
            "--sidebar-collapsed": `${COLLAPSED_WIDTH}px`,
            "--mobile-sidebar-width": open ? MOBILE_DRAWER_WIDTH : "0px",
          } as React.CSSProperties
        }
        className={`relative z-40 flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar/95 text-sidebar-foreground transition-[width,transform] duration-200 ease-[var(--ease-spring)] lg:w-[var(--sidebar-expanded)] ${
          collapsed ? "lg:!w-[var(--sidebar-collapsed)]" : ""
        } max-lg:kova-glass max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[var(--mobile-sidebar-width)] max-lg:rounded-r-xl max-lg:shadow-2xl`}
        aria-label="Primary navigation"
        aria-modal={open && isMobileViewport() ? true : undefined}
        role={open && isMobileViewport() ? "dialog" : "navigation"}
      >
        <div className="flex h-full min-w-[var(--sidebar-collapsed)] flex-col overflow-hidden">
          <div
            className={`relative z-20 flex min-h-[52px] items-center bg-sidebar/90 px-2.5 pt-[var(--safe-top)] ${collapsed ? "lg:justify-center" : "gap-2"}`}
          >
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 ${collapsed ? "lg:flex-none" : ""}`}
            >
              <span className="inline-flex shrink-0 rounded-full dark:bg-black dark:p-[2px] dark:ring-1 dark:ring-black">
                <NovaLogo className="h-7 w-7" animated />
              </span>
              <span
                className={
                  collapsed
                    ? "sr-only"
                    : "truncate font-display text-[17px] font-semibold tracking-tight"
                }
              >
                KovaGPT
              </span>
            </div>
            <div
              className={`ml-auto flex shrink-0 items-center gap-1 ${collapsed ? "lg:ml-0" : ""}`}
            >
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={onToggle}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition hover:bg-sidebar-hover active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
                title={open ? "Collapse sidebar" : "Expand sidebar"}
              >
                <PanelLeft className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-sidebar via-sidebar/90 to-transparent"
          />

          {searchOpen && !collapsed ? (
            <div className="px-3 pb-2">
              <label className="sr-only" htmlFor="sidebar-chat-search">
                Search chats
              </label>
              <input
                id="sidebar-chat-search"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, messages, or operators…"
                className="h-11 w-full rounded-xl bg-sidebar-hover/60 px-3 text-sm outline-none transition focus:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-0.5 px-2 pt-2">
            <button
              onClick={() => {
                onNew();
                closeAfterMobileNavigation();
              }}
              className={`kova-nav-row ${iconOnly}`}
              aria-label="New chat"
              title="New chat"
            >
              <SquarePen className="h-[18px] w-[18px] shrink-0" />
              <span className={labelClass}>New chat</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              className={`kova-nav-row ${iconOnly}`}
              aria-label="Search chats"
              title="Search chats"
            >
              <Search className="h-[18px] w-[18px] shrink-0" />
              <span className={labelClass}>Search</span>
            </button>
            {onOpenArchived ? (
              <button
                type="button"
                onClick={onOpenArchived}
                className={`kova-nav-row ${iconOnly}`}
                aria-label="Archived chats"
                title="Archived chats"
              >
                <Archive className="h-[18px] w-[18px] shrink-0" />
                <span className={labelClass}>Archived chats</span>
              </button>
            ) : null}
            {showSignedIn ? renderNavLink("/projects", "Projects", FolderKanban) : null}
            {renderNavLink("/recents", "Recents", Clock3)}
            {showSignedIn ? renderNavLink("/work", "Work", BriefcaseBusiness) : null}
            {showSignedIn ? renderNavLink("/research-planner", "Research", FlaskConical) : null}
            {showSignedIn ? renderNavLink("/prompt-studio", "Prompt Studio", ScrollText) : null}
            {showSignedIn ? renderNavLink("/knowledge-graph", "Knowledge Graph", Network) : null}
            {showSignedIn ? renderNavLink("/omega", "Omega Control Center", Orbit) : null}
            {renderNavLink("/library", "Library", FolderOpen)}
            {showSignedIn ? renderNavLink("/files", "Files", Files) : null}
            {showSignedIn ? renderNavLink("/context-packs", "Context packs", Boxes) : null}
            {showSignedIn ? renderNavLink("/memory", "Memory", Brain) : null}
            {renderNavLink("/images", "Images", ImageIcon)}
            {renderNavLink("/apps", "Apps", Plug)}
            {showSignedIn && (tier === "plus" || tier === "pro")
              ? renderNavLink(
                  "/scheduled-tasks",
                  "Scheduled tasks",
                  Calendar,
                  isOn("/scheduled-tasks"),
                )
              : null}
            {tier !== "plus" && tier !== "pro"
              ? renderNavLink("/pricing", "Subscriptions", CreditCard, isOn("/pricing"))
              : null}
          </div>

          <nav className="relative mt-2 min-h-0 flex-1 overflow-y-auto pb-4" aria-label="Chats">
            <div
              aria-hidden="true"
              className="pointer-events-none sticky top-0 z-10 h-4 bg-gradient-to-b from-sidebar to-transparent"
            />
            {!collapsed ? (
              <>
                {!isLoaded && conversations.length === 0 ? (
                  <div className="space-y-2 px-3 pt-4" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="mx-2 h-8 rounded-xl bg-sidebar-hover/50 animate-pulse"
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
            ) : (
              <div
                className="px-2 pt-3 text-center text-xs text-muted-foreground"
                aria-hidden="true"
              >
                •••
              </div>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none sticky bottom-0 z-10 h-8 bg-gradient-to-t from-sidebar to-transparent"
            />
          </nav>

          <div
            className={`mt-auto border-t border-border/60 bg-sidebar/95 p-2.5 pb-[max(.625rem,var(--safe-bottom))] ${collapsed ? "lg:px-2" : ""}`}
          >
            {!isLoaded ? null : showSignedIn ? (
              <div className={`flex items-center gap-2 ${collapsed ? "lg:flex-col" : ""}`}>
                <button
                  onClick={() => {
                    onOpenSettings("general");
                    closeAfterMobileNavigation();
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidebar-hover transition hover:bg-sidebar-hover/80 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidebar-hover transition hover:bg-sidebar-hover/80 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
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
              <div className="space-y-2">
                <button
                  onClick={() => onOpenSettings("general")}
                  className={`flex min-h-11 w-full items-center rounded-xl py-2 text-sm transition hover:bg-sidebar-hover ${iconOnly}`}
                  aria-label="Settings"
                >
                  <SettingsIcon className="h-4 w-4" />
                  <span className={labelClass}>Settings</span>
                </button>
                {!collapsed ? (
                  <SignInButton mode="modal">
                    <button className="flex min-h-11 w-full items-center justify-center rounded-full bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90">
                      Log in
                    </button>
                  </SignInButton>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
