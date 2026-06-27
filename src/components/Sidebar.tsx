import { MessageSquare, Trash2, PanelLeft, Search, HelpCircle, Plus, Share2, Settings as SettingsIcon, FolderOpen, Link2, MoreHorizontal, Briefcase, MessageCircle } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SignInButton, UserButton, useUser } from "@/components/auth/ClerkSafe";

import type { Conversation } from "@/lib/chat-store";


const MIN_W = 200;
const MAX_W = 480;
const WIDTH_KEY = "nova-gpt-sidebar-width";

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onShare,
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
  open: boolean;
  onToggle: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenHelp: () => void;
}) {
  const { user, isSignedIn } = useUser();
  const [width, setWidth] = useState<number>(280);
  const [moreOpen, setMoreOpen] = useState(false);
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

  const navItemClass =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] hover:bg-sidebar-hover transition active:scale-[0.98]";

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
        className="relative shrink-0 overflow-hidden transition-[width] duration-150 bg-sidebar text-sidebar-foreground border-r border-border flex flex-col max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:h-[100dvh]"
      >
        <div style={{ width }} className="flex flex-col h-full">
          {/* Brand row with search + collapse */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex rounded-full dark:bg-black dark:p-[2px] dark:ring-1 dark:ring-black">
                <NovaLogo className="w-7 h-7" />
              </span>
              <span className="font-display font-semibold tracking-tight text-[18px]">KovaGPT</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className="p-2 rounded-md hover:bg-sidebar-hover transition active:scale-95"
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={onToggle}
                className="p-2 rounded-md hover:bg-sidebar-hover transition md:hidden"
                aria-label="Toggle sidebar"
              >
                <PanelLeft className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

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

          {/* New chat (kept; ChatGPT puts it in the bottom pill but users need it accessible) */}
          <div className="px-3 pb-2">
            <button
              onClick={onNew}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] hover:bg-sidebar-hover transition active:scale-[0.98]"
            >
              <Plus className="w-[18px] h-[18px]" />
              <span>New chat</span>
            </button>
          </div>

          {/* Primary nav */}
          <div className="px-3 flex flex-col gap-0.5">
            <Link to="/library" className={navItemClass}>
              <FolderOpen className="w-[18px] h-[18px]" />
              <span>Library</span>
            </Link>
            <Link to="/apps" className={navItemClass}>
              <Link2 className="w-[18px] h-[18px]" />
              <span>Apps</span>
            </Link>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={`${navItemClass} w-full text-left`}
            >
              <MoreHorizontal className="w-[18px] h-[18px]" />
              <span>More</span>
            </button>
            {moreOpen && (
              <div className="mx-3 mt-1 mb-1 rounded-xl bg-sidebar-hover/60 p-1.5 flex flex-col gap-0.5">
                <Link to="/images" className="rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition">
                  Image Generation
                </Link>
                <Link to="/pricing" className="rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition">
                  Subscriptions
                </Link>
              </div>
            )}
          </div>


          {/* Pinned */}
          {isSignedIn && (
            <>
              <div className="px-5 pt-5 pb-1.5 text-[13px] font-medium text-muted-foreground">
                Pinned
              </div>
              <div className="px-3 flex flex-col gap-0.5">
                <button className={`${navItemClass} w-full text-left`}>
                  <Briefcase className="w-[18px] h-[18px]" />
                  <span>Check portfolio</span>
                </button>
              </div>
            </>
          )}

          {/* Recents / Chats */}
          <div className="px-5 pt-5 pb-1.5 text-[13px] font-medium text-muted-foreground">
            {isSignedIn ? "Recents" : "Chats"}
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
            {conversations.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No chats yet</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] cursor-pointer transition ${
                  activeId === c.id ? "bg-sidebar-hover" : "hover:bg-sidebar-hover"
                }`}
                onClick={() => onSelect(c.id)}
              >
                <span className="flex-1 truncate">{c.title}</span>
                {onShare && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onShare(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/40 transition active:scale-95"
                    aria-label="Share chat"
                  >
                    <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/40 transition active:scale-95"
                  aria-label="Delete chat"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </nav>

          {/* Bottom row: Chat pill + Settings gear (ChatGPT style) */}
          {isSignedIn ? (
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
          ) : (
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
                    Log in to get answers based on saved chats, plus create images and upload files.
                  </div>
                </div>
                <SignInButton mode="modal">
                  <button className="w-full flex items-center justify-center px-3 py-2 rounded-full bg-foreground text-background hover:opacity-90 text-sm font-medium transition">
                    Log in
                  </button>
                </SignInButton>
              </div>
            </>
          )}

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
