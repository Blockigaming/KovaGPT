import { Plus, MessageSquare, Trash2, PanelLeft, Search, Sparkles, Settings as Cog } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import type { Conversation } from "@/lib/chat-store";
import { NovaLogo } from "./NovaLogo";

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  open,
  onToggle,
  onOpenSettings,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const { user } = useUser();

  return (
    <aside
      className={`${
        open ? "w-64" : "w-0"
      } shrink-0 overflow-hidden transition-all duration-200 bg-sidebar text-sidebar-foreground border-r border-border flex flex-col`}
    >
      <div className="w-64 flex flex-col h-full">
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
          <NovaLogo className="w-6 h-6" />
          <span>New chat</span>
        </button>

        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-hover transition cursor-pointer">
          <Search className="w-4 h-4" />
          <span>Search chats</span>
        </div>

        <Link
          to="/pricing"
          className="mx-3 mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover transition"
        >
          <Sparkles className="w-4 h-4" />
          <span>View pricing plans</span>
        </Link>

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
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-hover transition text-sm"
          >
            <Cog className="w-4 h-4" />
            <span>Settings</span>
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
    </aside>
  );
}
