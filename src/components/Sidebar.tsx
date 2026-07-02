import { Trash2, PanelLeft, Search, HelpCircle, Plus, Share2, Settings as SettingsIcon, FolderOpen, Link2, MoreHorizontal, MessageCircle, Copy as CopyIcon, Archive, Pin, PinOff, Users, Image as ImageIcon, CreditCard, Calendar } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NovaLogo } from "@/components/NovaLogo";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SignInButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import { useTier } from "@/hooks/useTier";

import type { Conversation } from "@/lib/chat-store";


const SIDEBAR_WIDTH = 264;


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
}) {
  const { user, isSignedIn, isLoaded } = useUser();
  const { tier } = useTier();
  const [width, setWidth] = useState<number>(280);
  
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");


  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
      if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
    } catch { /* ignore */ }
  }, []);

  const clampWidth = (w: number) => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const cap = Math.max(MIN_W, Math.min(MAX_W, Math.floor(vw * 0.4)));
    return Math.max(MIN_W, Math.min(cap, w));
  };

  useEffect(() => {
    const move = (clientX: number) => {
      if (!draggingRef.current) return;
      setWidth(clampWidth(clientX));
    };
    const onMove = (e: MouseEvent) => move(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const t = e.touches[0];
      if (t) {
        e.preventDefault();
        move(t.clientX);
      }
    };
    const stop = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
      }
    };
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", stop);
    window.addEventListener("touchcancel", stop);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      window.removeEventListener("resize", onResize);
    };
  }, [width]);

  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const showSignedIn = isLoaded && isSignedIn;
  const showSignedOut = isLoaded && !isSignedIn;

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOn = (p: string) => pathname === p;
  const navItemClass = (active: boolean) =>
    `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition active:scale-[0.98] min-w-0 ${
      active
        ? "bg-sidebar-hover text-foreground"
        : "hover:bg-sidebar-hover text-sidebar-foreground"
    }`;
  const ActiveBar = ({ on }: { on: boolean }) =>
    on ? (
      <span
        aria-hidden
        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#3b82f6]"
      />
    ) : null;

  return (
    <>
      {open && (
        <div
          onClick={onToggle}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}
      <aside
        style={{ width: open ? width : 0 }}
        className="relative shrink-0 overflow-hidden transition-[width] duration-150 bg-sidebar text-sidebar-foreground border-r border-border/60 flex flex-col max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:h-[100dvh]"
      >
        <div style={{ width }} className="flex flex-col h-full">
          {/* Brand row sits on top; fade beneath obscures scrolled content */}
          <div className="relative z-20 flex items-center gap-2 px-3 sm:px-4 pt-4 pb-3 bg-sidebar">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex shrink-0 rounded-full dark:bg-black dark:p-[2px] dark:ring-1 dark:ring-black">
                <NovaLogo className="w-7 h-7" />
              </span>
              {width >= 240 && (
                <span className="font-display font-semibold tracking-tight text-[18px] truncate">
                  KovaGPT
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className="shrink-0 p-2 rounded-md transition-all duration-200 hover:bg-sidebar-hover hover:scale-110 active:scale-95"
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={onToggle}
                className="shrink-0 p-2 rounded-md transition-all duration-200 hover:bg-sidebar-hover hover:scale-110 active:scale-95"
                aria-label="Toggle sidebar"
                title="Toggle sidebar"
              >
                <PanelLeft className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          {/* Subtle fade so scrolled chat list dissolves into the header area */}
          <div
            aria-hidden="true"
            className="pointer-events-none relative z-10 -mt-1 h-4 bg-gradient-to-b from-sidebar to-transparent"
          />


          {searchOpen && (
            <div className="px-3 pb-2">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full rounded-lg bg-sidebar-hover/60 px-3 py-2 text-sm outline-none focus:bg-sidebar-hover transition"
              />
            </div>
          )}

          {/* New chat */}
          <div className="px-3 pb-2">
            <button
              onClick={onNew}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] hover:bg-sidebar-hover transition active:scale-[0.98]"
            >
              <Plus className="w-[18px] h-[18px]" />
              <span>New chat</span>
            </button>
          </div>

          {/* Workspace nav */}
          <div className="px-5 pt-1 pb-1 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/80">
            Workspace
          </div>
          <div className="px-3 flex flex-col gap-0.5">
            <Link to="/library" className={navItemClass(isOn("/library"))}>
              <ActiveBar on={isOn("/library")} />
              <FolderOpen className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">Library</span>
            </Link>
            <Link to="/apps" className={navItemClass(isOn("/apps"))}>
              <ActiveBar on={isOn("/apps")} />
              <Link2 className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">Apps</span>
            </Link>
            <Link to="/images" className={navItemClass(isOn("/images"))}>
              <ActiveBar on={isOn("/images")} />
              <ImageIcon className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">Image Generation</span>
            </Link>
            {showSignedIn && (tier === "plus" || tier === "pro") && (
              <Link to="/scheduled-tasks" className={navItemClass(isOn("/scheduled-tasks"))}>
                <ActiveBar on={isOn("/scheduled-tasks")} />
                <Calendar className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate">Scheduled Tasks</span>
              </Link>
            )}
            <Link to="/pricing" className={navItemClass(isOn("/pricing"))}>
              <ActiveBar on={isOn("/pricing")} />
              <CreditCard className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">Subscriptions</span>
            </Link>
          </div>

          {/* Combined scrollable area: Pinned + Recents */}
          <nav className="flex-1 overflow-y-auto min-h-0 pb-2">
            {(() => {
              const q = searchQuery.trim().toLowerCase();
              const filtered = q
                ? conversations.filter((c) => c.title.toLowerCase().includes(q))
                : conversations;
              const pinned = filtered
                .filter((c) => c.pinned)
                .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
              const recents = filtered.filter((c) => !c.pinned);

              const renderRow = (c: Conversation) => (
                <div
                  key={c.id}
                  className={`group mx-2 my-0.5 flex items-center gap-1 rounded-xl px-3 py-2 text-[14px] cursor-pointer transition bg-sidebar-hover/60 hover:bg-sidebar-hover ${
                    activeId === c.id ? "bg-sidebar-hover ring-1 ring-border/60" : ""
                  }`}
                  onClick={() => onSelect(c.id)}
                >
                  {c.pinned && (
                    <Pin className="w-3 h-3 mr-1 shrink-0 text-muted-foreground fill-current" />
                  )}
                  <span className="flex-1 truncate">{c.title}</span>
                  {onTogglePin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(c.id);
                      }}
                      className={`p-1 rounded hover:bg-background/40 transition active:scale-95 ${
                        c.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                      aria-label={c.pinned ? "Unpin chat" : "Pin chat"}
                      title={c.pinned ? "Unpin chat" : "Pin chat"}
                    >
                      {c.pinned ? (
                        <PinOff className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <Pin className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-1 rounded hover:bg-background/40 transition active:scale-95"
                        aria-label="Chat options"
                      >
                        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-44"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onTogglePin && (
                        <DropdownMenuItem onClick={() => onTogglePin(c.id)}>
                          {c.pinned ? (
                            <><PinOff className="w-4 h-4 mr-2" /> Unpin</>
                          ) : (
                            <><Pin className="w-4 h-4 mr-2" /> Pin</>
                          )}
                        </DropdownMenuItem>
                      )}
                      {onShare && (
                        <DropdownMenuItem onClick={() => onShare(c.id)}>
                          <Share2 className="w-4 h-4 mr-2" /> Share
                        </DropdownMenuItem>
                      )}
                      {showSignedIn && onAddMembers && (
                        <DropdownMenuItem onClick={() => onAddMembers(c.id)}>
                          <Users className="w-4 h-4 mr-2" /> Add members
                        </DropdownMenuItem>
                      )}
                      {onDuplicate && (
                        <DropdownMenuItem onClick={() => onDuplicate(c.id)}>
                          <CopyIcon className="w-4 h-4 mr-2" /> Duplicate
                        </DropdownMenuItem>
                      )}
                      {onArchive && (
                        <DropdownMenuItem onClick={() => onArchive(c.id)}>
                          <Archive className="w-4 h-4 mr-2" /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDelete(c.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );

              if (filtered.length === 0) {
                return (
                  <div className="px-5 py-3 text-sm text-muted-foreground">
                    {q ? "No matches" : "No chats yet"}
                  </div>
                );
              }

              return (
                <>
                  {pinned.length > 0 && (
                    <>
                      <div className="px-5 pt-4 pb-1.5 text-[13px] font-medium text-muted-foreground flex items-center gap-1.5">
                        <Pin className="w-3 h-3" /> Pinned
                      </div>
                      {pinned.map(renderRow)}
                    </>
                  )}
                  <div className="px-5 pt-4 pb-1.5 text-[13px] font-medium text-muted-foreground">
                    {showSignedIn ? "Recents" : "Chats"}
                  </div>
                  {recents.length === 0 ? (
                    <div className="px-5 py-2 text-sm text-muted-foreground">No recent chats</div>
                  ) : (
                    recents.map(renderRow)
                  )}
                </>
              );
            })()}
          </nav>

          {/* Bottom row: Chat pill + Settings gear (ChatGPT style) */}
          {!isLoaded ? (
            <div className="border-t border-border/60 p-3" />
          ) : showSignedIn ? (
            <div className="border-t border-border/60 p-3 flex items-center gap-2">
              <button
                onClick={onNew}
                className="flex-1 flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground hover:opacity-90 px-4 py-2.5 text-sm font-medium transition active:scale-[0.98]"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Chat</span>
              </button>
              <button
                onClick={() => onOpenSettings("general")}
                className="p-2.5 rounded-full bg-sidebar-hover hover:bg-sidebar-hover/80 transition active:scale-95"
                aria-label="Settings"
              >
                <SettingsIcon className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={onOpenHelp}
                className="p-2.5 rounded-full bg-sidebar-hover hover:bg-sidebar-hover/80 transition active:scale-95"
                aria-label="Help"
              >
                <HelpCircle className="w-[18px] h-[18px]" />
              </button>
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <UserButton />
              </div>
            </div>
          ) : showSignedOut ? (
            <>
              <div className="px-3 pb-2 pt-1 border-t border-border/60 flex flex-col gap-1">
                <button
                  onClick={() => onOpenSettings("general")}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-sidebar-hover transition text-left"
                >
                  <SettingsIcon className="w-4 h-4" />
                  <span>Settings</span>
                </button>
                <button
                  onClick={onOpenHelp}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-sidebar-hover transition text-left"
                >
                  <HelpCircle className="w-4 h-4" />
                  <span>Help</span>
                </button>
              </div>
              <div className="border-t border-border p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold mb-1">Get responses tailored to you</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    Log in to get answers based on saved chats, plus create images and upload files all for free with Kova.
                  </div>
                </div>
                <SignInButton mode="modal">
                  <button className="w-full flex items-center justify-center px-3 py-2 rounded-full bg-foreground text-background hover:opacity-90 text-sm font-medium transition">
                    Log in
                  </button>
                </SignInButton>
              </div>
            </>
          ) : null}

          {/* Hidden user reference to suppress unused warning when signed-in shows UserButton */}
          <span className="sr-only">{user?.firstName || ""}</span>
        </div>

        {open && (
          <div
            onMouseDown={startDrag}
            onTouchStart={startDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            style={{ touchAction: "none" }}
            className="absolute top-0 -right-1 h-full w-3 cursor-col-resize hover:bg-border/80 active:bg-border transition-colors z-20"
            title="Drag to resize"
          />
        )}
      </aside>
    </>
  );
}
