import { Link } from "@tanstack/react-router";
import { Search, SquarePen, Settings, Image as ImageIcon, FolderOpen, Plug, Calendar, X } from "lucide-react";
import type { Conversation } from "@/lib/chat-store";

const quickActions = [
  { label: "New chat", href: "/", icon: SquarePen },
  { label: "Explore GPTs", href: "/apps", icon: Plug },
  { label: "Library", href: "/library", icon: FolderOpen },
  { label: "Images", href: "/images", icon: ImageIcon },
  { label: "Scheduled tasks", href: "/scheduled-tasks", icon: Calendar },
];

export function CommandPalette({
  open,
  query,
  onQueryChange,
  conversations,
  onClose,
  onNewChat,
  onSelectChat,
  onOpenSettings,
}: {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  conversations: Conversation[];
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onOpenSettings: () => void;
}) {
  if (!open) return null;

  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? conversations.filter((chat) => chat.title.toLowerCase().includes(normalized)).slice(0, 8)
    : conversations.slice(0, 6);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/35 px-3 pt-[12vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Search chats and actions">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-popover text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search chats, GPTs, files, and actions"
            className="h-10 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close command palette">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Actions</div>
          <button
            type="button"
            onClick={() => { onNewChat(); onClose(); }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent"
          >
            <SquarePen className="h-4 w-4 text-muted-foreground" />
            <span>Start a new chat</span>
            <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">⌘ ⇧ O</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenSettings(); onClose(); }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent"
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span>Open settings</span>
          </button>
          {quickActions.slice(1).map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                to={action.href as never}
                onClick={onClose}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{action.label}</span>
              </Link>
            );
          })}

          <div className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">Chats</div>
          {matches.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No chats found</div>
          ) : (
            matches.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => { onSelectChat(chat.id); onClose(); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent"
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
