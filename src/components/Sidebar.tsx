import { Plus, MessageSquare, Trash2, PanelLeft, Search, Sparkles, Settings as Cog, HelpCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import type { Conversation } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";

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
  const { user } = useUser();
  const [width, setWidth] = useState<number>(260);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
      if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, e.clientX));
      setWidth(w);
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
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
        <div className="flex items-center justify-between p-3">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-sidebar-hover transition"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <button
            onClick={onNew}
            className="p-2 rounded-lg hover:bg-sidebar-hover transition"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={onNew}
          className="mx-3 mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-sidebar-hover transition"
        >
          <NovaLogo className="w-9 h-9" />
          <span>New chat</span>
        </button>

        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-hover transition cursor-pointer">
          <Search className="w-4 h-4" />
          <span>Search chats</span>
        </div>


        <SignedIn>
          <div className="px-3 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Chats
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-3">
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
        </SignedIn>

        <SignedOut>
          <div className="flex-1 px-4 py-6 text-center">
            <div className="text-sm text-muted-foreground mb-3">
              Sign in to save your chats across devices
            </div>
          </div>
        </SignedOut>

        <div className="border-t border-border p-3 space-y-1">
          <Link
            to="/pricing"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-hover transition text-sm"
          >
            <Sparkles className="w-4 h-4" />
            <span>View pricing plans</span>
          </Link>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-hover transition text-sm"
          >
            <Cog className="w-4 h-4" />
            <span>Settings</span>
          </button>
          <button
            onClick={onOpenHelp}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-hover transition text-sm"
          >
            <HelpCircle className="w-4 h-4" />
            <span>Help & FAQs</span>
          </button>

          <SignedIn>
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-hover transition">
              <UserButton />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress}
                </div>
                <div className="text-xs text-muted-foreground">Free plan</div>
              </div>
            </div>
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition">
                Log in / Sign up
              </button>
            </SignInButton>
          </SignedOut>
        </div>
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
