import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  SquarePen,
  Settings,
  Image as ImageIcon,
  FolderOpen,
  Plug,
  Calendar,
  X,
  FlaskConical,
  ShieldCheck,
  SunMoon,
  FileSearch,
} from "lucide-react";
import type { Conversation } from "@/lib/chat-store";

const quickActions = [
  { label: "New chat", href: "/", icon: SquarePen },
  { label: "Search workspace", action: "search", icon: Search },
  { label: "New project", href: "/projects", icon: FolderOpen },
  { label: "Open Library", href: "/library", icon: FolderOpen },
  { label: "Generate image", href: "/images", icon: ImageIcon },
  {
    label: "Start Deep Research",
    action: "deep-research",
    icon: FileSearch,
    disabledReason: "Available from the Deep Research mode in chat.",
  },
  {
    label: "Temporary Chat",
    action: "temporary-chat",
    icon: ShieldCheck,
    disabledReason: "Start from the composer privacy menu.",
  },
  { label: "Create Scheduled Task", href: "/scheduled-tasks", icon: Calendar },
  { label: "Open Apps", href: "/apps", icon: Plug },
  { label: "Open Help", href: "/help", icon: FlaskConical },
  { label: "Toggle appearance", action: "theme", icon: SunMoon },
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
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? conversations.filter((chat) => chat.title.toLowerCase().includes(normalized)).slice(0, 8)
    : conversations.slice(0, 6);
  const [activeIndex, setActiveIndex] = useState(0);
  const actionItems = useMemo(
    () => [
      "new-chat",
      "settings",
      ...quickActions.slice(1).map((action) => action.href ?? action.action),
    ],
    [],
  );
  const totalItems = actionItems.length + matches.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const chooseActive = () => {
    const action = actionItems[activeIndex];
    if (action === "new-chat") {
      onNewChat();
      onClose();
      return;
    }
    if (action === "settings") {
      onOpenSettings();
      onClose();
      return;
    }
    if (typeof action === "string" && action.startsWith("/")) {
      window.location.assign(action);
      onClose();
      return;
    }
    if (!action) {
      const chat = matches[activeIndex - actionItems.length];
      if (chat) {
        onSelectChat(chat.id);
        onClose();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/35 px-3 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search chats and actions"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((i) => Math.min(totalItems - 1, i + 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
        }
        if (event.key === "Enter") {
          event.preventDefault();
          chooseActive();
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-popover text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search chats, apps, files, and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={`command-option-${activeIndex}`}
            aria-label="Search commands and chats"
            className="h-10 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Command palette results"
          className="max-h-[60vh] overflow-y-auto p-2"
        >
          <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Actions</div>
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            id="command-option-0"
            role="option"
            aria-selected={activeIndex === 0}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === 0 ? "bg-accent" : ""}`}
          >
            <SquarePen className="h-4 w-4 text-muted-foreground" />
            <span>Start a new chat</span>
            <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              ⌘ ⇧ O
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            id="command-option-1"
            role="option"
            aria-selected={activeIndex === 1}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === 1 ? "bg-accent" : ""}`}
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span>Open settings</span>
          </button>
          {quickActions.slice(1).map((action, actionIndex) => {
            const Icon = action.icon;
            const index = actionIndex + 2;
            const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === index ? "bg-accent" : ""} ${action.disabledReason ? "text-muted-foreground" : ""}`;
            const content = (
              <>
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{action.label}</span>
                {action.disabledReason ? (
                  <span className="ml-auto text-[11px]">{action.disabledReason}</span>
                ) : null}
              </>
            );
            if (action.href) {
              return (
                <Link
                  key={action.href}
                  id={`command-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  to={action.href as never}
                  onClick={onClose}
                  className={className}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={action.action}
                id={`command-option-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                type="button"
                disabled={!!action.disabledReason}
                className={className}
              >
                {content}
              </button>
            );
          })}

          <div className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">Chats</div>
          {matches.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No chats found
            </div>
          ) : (
            matches.map((chat, chatIndex) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  onSelectChat(chat.id);
                  onClose();
                }}
                id={`command-option-${actionItems.length + chatIndex}`}
                role="option"
                aria-selected={activeIndex === actionItems.length + chatIndex}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === actionItems.length + chatIndex ? "bg-accent" : ""}`}
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
