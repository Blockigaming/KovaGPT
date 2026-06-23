import { MessageSquare, Trash2, PanelLeft, Search, Sparkles, Settings as Cog, HelpCircle, ImageIcon, Plus } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { Link, useRouter } from "@tanstack/react-router";
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
  open: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}) {
  const { user, isSignedIn } = useUser();
  const [width, setWidth] = useState<number>(260);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
      if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
    } catch { /* ignore */ }
  }, []);

  // Clamp width to a sensible fraction of the viewport so the sidebar
  // never eats the whole screen on smaller laptops (e.g. Chromebooks at
  // ~1366px or zoomed displays).
  const clampWidth = (w: number) => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const cap = Math.max(MIN_W, Math.min(MAX_W, Math.floor(vw * 0.4)));
    return Math.max(MIN_W, Math.min(cap, w));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setWidth(clampWidth(e.clientX));
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
      }
    };
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, [width]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside
      style={{ width: open ? width : 0 }}
      className="relative shrink-0 overflow-hidden transition-[width] duration-150 bg-sidebar text-sidebar-foreground border-r border-border flex flex-col"
    >
      <div style={{ width }} className="flex flex-col h-full">
        {/* Brand row */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full dark:bg-black dark:p-[2px] dark:ring-1 dark:ring-black">
              <NovaLogo className="w-6 h-6" />
            </span>
            <span className="font-display font-semibold tracking-tight text-[15px]">KovaGPT</span>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-sidebar-hover transition"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Prominent New chat pill */}
        <div className="px-3 pb-3">
          <button
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 rounded-full border border-border bg-background hover:bg-sidebar-hover px-3 py-2 text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            <span>New chat</span>
          </button>
        </div>

        {/* Search as input-style */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-hover/60 hover:bg-sidebar-hover px-3 py-2 text-sm text-muted-foreground cursor-pointer transition">
            <Search className="w-4 h-4" />
            <span>Search chats</span>
          </div>
        </div>

        {/* Compact nav row */}
        <div className="px-3 pb-2 flex items-center gap-2">
          <Link
            to="/images"
            className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition"
          >
            <ImageIcon className="w-4 h-4" />
            <span>Images</span>
          </Link>
          <Link
            to="/pricing"
            className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>Plans</span>
          </Link>
        </div>

        {/* Chats list (signed in) or flexible spacer (signed out) */}
        {isSignedIn ? (
          <>
            <div className="px-3 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Chats
            </div>
            <nav className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
              {conversations.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No chats yet</div>
              )}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition ${
                    activeId === c.id ? "bg-sidebar-hover" : "hover:bg-sidebar-hover"
                  }`}
                  onClick={() => onSelect(c.id)}
                >
                  <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/40 transition"
                    aria-label="Delete chat"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </nav>
          </>
        ) : (
          <div className="flex-1 min-h-0" />
        )}

        {/* Secondary nav: plans, settings, help */}
        <div className="px-2 pb-2 space-y-0.5">
          <Link
            to="/pricing"
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>See plans and pricing</span>
          </Link>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition text-left"
          >
            <Cog className="w-4 h-4" />
            <span>Settings</span>
          </button>
          <button
            onClick={onOpenHelp}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition text-left"
          >
            <HelpCircle className="w-4 h-4" />
            <span>Help</span>
          </button>
        </div>

        {/* Bottom: signed-in user card OR signed-out promo */}
        {isSignedIn ? (
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-hover transition">
              <UserButton />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress}
                </div>
                <div className="text-xs text-muted-foreground">Free plan</div>
              </div>
            </div>
          </div>
        ) : (
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
        )}
      </div>


      {open && (
        <div
          onMouseDown={startDrag}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-border/80 active:bg-border transition-colors z-10"
          title="Drag to resize"
        />
      )}
    </aside>
  );
}
