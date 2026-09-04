import { Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  SquarePen,
  Settings,
  Image as ImageIcon,
  FolderOpen,
  Calendar,
  X,
  FlaskConical,
  ShieldCheck,
  SunMoon,
  FileSearch,
  Boxes,
  Star,
  Zap,
} from "lucide-react";
import type { Conversation } from "@/lib/chat-store";
import type { RecentItem } from "@/lib/workspace.functions";
import type { LucideIcon } from "lucide-react";
import { CAPABILITIES } from "@/platform/capabilities";
import { extensionRegistry } from "@/platform/extensions";
import { platformEvents } from "@/platform/events";
import { applyThemeMode } from "@/lib/theme";
import { searchConversations } from "@/lib/conversation-search";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

type PaletteAction = {
  label: string;
  href?: string;
  action?: string;
  icon: LucideIcon;
  disabledReason?: string;
  keywords?: readonly string[];
};

const fixedActions: PaletteAction[] = [
  { label: "New chat", href: "/", icon: SquarePen },
  { label: "Search workspace", action: "search", icon: Search },
  {
    label: "Focus message box",
    action: "focus-input",
    icon: Zap,
    keywords: ["capture", "send", "continue", "selection"],
  },
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
  { label: "Scheduled Tasks status", href: "/scheduled-tasks", icon: Calendar },
  { label: "Open Help", href: "/help", icon: FlaskConical },
  { label: "Toggle appearance", action: "theme", icon: SunMoon },
];

// Routes that are internal or retired stay out of workspace search so results
// never point at pages we no longer surface in navigation.
const HIDDEN_PALETTE_ROUTES = new Set(["/apps", "/omega"]);

const quickActions: PaletteAction[] = [
  ...fixedActions,
  ...CAPABILITIES.filter(
    (capability) =>
      !HIDDEN_PALETTE_ROUTES.has(capability.route) &&
      !fixedActions.some((action) => action.href === capability.route),
  ).map((capability) => ({
    label: `Open ${capability.label}`,
    href: capability.route,
    icon: Boxes,
    keywords: capability.keywords,
  })),

  ...extensionRegistry.contributions("command").flatMap((contribution) =>
    contribution.command
      ? [
          {
            label: contribution.command.label,
            href: contribution.command.href,
            action: contribution.id,
            icon: Boxes,
            keywords: contribution.command.keywords,
          },
        ]
      : [],
  ),
];

function fuzzyScore(candidate: string, query: string) {
  if (!query) return 1;
  const text = candidate.toLowerCase();
  if (text.includes(query)) return 100 - text.indexOf(query);
  let cursor = 0;
  for (const character of query) {
    cursor = text.indexOf(character, cursor);
    if (cursor < 0) return 0;
    cursor += 1;
  }
  return 10;
}

function parseStoredCommandIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function resolveReturnFocusTarget(target: HTMLElement | null): HTMLElement | null {
  if (target?.isConnected) return target;
  const candidates = document.querySelectorAll<HTMLElement>(
    '[data-testid="model-selector-trigger"], button[aria-label="Open menu"], button[aria-label="Search chats"]',
  );
  return (
    Array.from(candidates).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    }) ?? null
  );
}

export function CommandPalette({
  open,
  query,
  onQueryChange,
  conversations,
  archivedConversations,
  workspaceItems,
  workspaceStatus = "ready",
  retryWorkspaceSearch,
  onClose,
  onNewChat,
  onSelectChat,
  onSelectArchived,
  onOpenSettings,
  returnFocusTarget,
}: {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  conversations: Conversation[];
  archivedConversations: Conversation[];
  workspaceItems: RecentItem[];
  workspaceStatus?: "loading" | "ready" | "error";
  retryWorkspaceSearch?: () => void;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onSelectArchived: (conversation: Conversation) => void;
  onOpenSettings: () => void;
  returnFocusTarget?: HTMLElement | null;
}) {
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const historyStorageKey = isLoaded
    ? principalScopedStorageKey("kova-command-history-v1", userKey)
    : null;
  const pinsStorageKey = isLoaded
    ? principalScopedStorageKey("kova-command-pins-v1", userKey)
    : null;
  const deferredQuery = useDeferredValue(query);
  const normalized = deferredQuery.trim().toLowerCase();
  const conversationMatches = normalized
    ? searchConversations([...conversations, ...archivedConversations], deferredQuery).slice(0, 8)
    : conversations.slice(0, 6).map((conversation) => ({
        conversation,
        snippet: `${conversation.messages.length} messages`,
        score: 0,
      }));
  const [activeOptionKey, setActiveOptionKey] = useState("action:new-chat");
  const storageGenerationRef = useRef(0);
  const [commandState, setCommandState] = useState<{
    principal: string | null;
    generation: number;
    recent: string[];
    pinned: string[];
  }>({ principal: null, generation: 0, recent: [], pinned: [] });
  const commandReady =
    principal !== null &&
    commandState.principal === principal &&
    commandState.generation === storageGenerationRef.current;
  const recentCommands = useMemo(
    () => (commandReady ? commandState.recent : []),
    [commandReady, commandState.recent],
  );
  const pinnedCommands = useMemo(
    () => (commandReady ? commandState.pinned : []),
    [commandReady, commandState.pinned],
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    shouldRestoreFocusRef.current = true;
    returnFocusRef.current =
      returnFocusTarget ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const returnTarget = returnFocusRef.current;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());

    return () => {
      if (!shouldRestoreFocusRef.current) return;
      const restoreFocus = () => {
        const target = resolveReturnFocusTarget(returnTarget);
        if (target && document.activeElement !== target) {
          target.focus({ preventScroll: true });
        }
      };
      restoreFocus();
      window.requestAnimationFrame(restoreFocus);
    };
  }, [open, returnFocusTarget]);
  useEffect(() => {
    const generation = storageGenerationRef.current + 1;
    storageGenerationRef.current = generation;
    if (!open || !isLoaded || !principal || !historyStorageKey || !pinsStorageKey) {
      setCommandState({ principal, generation, recent: [], pinned: [] });
      return;
    }
    const storage = safeBrowserStorage("localStorage");
    try {
      const recent = parseStoredCommandIds(storage?.getItem(historyStorageKey) ?? null);
      const pinned = parseStoredCommandIds(storage?.getItem(pinsStorageKey) ?? null);
      if (storageGenerationRef.current !== generation) return;
      setCommandState({ principal, generation, recent, pinned });
    } catch {
      if (storageGenerationRef.current !== generation) return;
      setCommandState({ principal, generation, recent: [], pinned: [] });
    }
  }, [historyStorageKey, isLoaded, open, pinsStorageKey, principal]);

  useEffect(() => {
    if (!isLoaded) return;
    const handlePrincipalReset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      const generation = storageGenerationRef.current + 1;
      storageGenerationRef.current = generation;
      setCommandState({ principal, generation, recent: [], pinned: [] });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, handlePrincipalReset);
    return () =>
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, handlePrincipalReset);
  }, [isLoaded, principal, userKey]);

  const saveRecentCommands = (next: string[]) => {
    const generation = commandState.generation;
    if (
      !commandReady ||
      !historyStorageKey ||
      generation !== storageGenerationRef.current ||
      commandState.principal !== principal
    )
      return;
    setCommandState((current) =>
      current.principal === principal && current.generation === generation
        ? { ...current, recent: next }
        : current,
    );
    try {
      if (generation !== storageGenerationRef.current) return;
      safeBrowserStorage("localStorage")?.setItem(historyStorageKey, JSON.stringify(next));
    } catch {
      // Command history is optional; the action itself can still continue.
    }
  };

  const savePinnedCommands = (next: string[]) => {
    const generation = commandState.generation;
    if (
      !commandReady ||
      !pinsStorageKey ||
      generation !== storageGenerationRef.current ||
      commandState.principal !== principal
    )
      return;
    setCommandState((current) =>
      current.principal === principal && current.generation === generation
        ? { ...current, pinned: next }
        : current,
    );
    try {
      if (generation !== storageGenerationRef.current) return;
      safeBrowserStorage("localStorage")?.setItem(pinsStorageKey, JSON.stringify(next));
    } catch {
      // Pins remain available for this render when durable storage is blocked.
    }
  };
  const visibleActions = useMemo(
    () =>
      quickActions
        .slice(1)
        .map((action) => ({
          ...action,
          score:
            fuzzyScore(`${action.label} ${(action.keywords ?? []).join(" ")}`, normalized) +
            (recentCommands.includes(action.href ?? action.action ?? "") ? 5 : 0) +
            (pinnedCommands.includes(action.href ?? action.action ?? "") ? 20 : 0),
        }))
        .filter((action) => action.score > 0)
        .sort((a, b) => b.score - a.score),
    [normalized, recentCommands, pinnedCommands],
  );
  const visibleWorkspaceItems = useMemo(
    () =>
      workspaceItems
        .filter((item) =>
          normalized ? `${item.title} ${item.subtitle}`.toLowerCase().includes(normalized) : true,
        )
        .slice(0, 20),
    [normalized, workspaceItems],
  );
  const actionItems = useMemo(
    () => ["new-chat", "settings", ...visibleActions.map((action) => action.href ?? action.action)],
    [visibleActions],
  );
  const workspaceStartIndex = actionItems.length;
  const chatStartIndex = workspaceStartIndex + visibleWorkspaceItems.length;
  const optionKeys = useMemo(
    () => [
      ...actionItems.map((item, index) => `action:${item ?? index}`),
      ...visibleWorkspaceItems.map((item) => `workspace:${item.type}:${item.id}`),
      ...conversationMatches.map(({ conversation }) => `chat:${conversation.id}`),
    ],
    [actionItems, conversationMatches, visibleWorkspaceItems],
  );
  const resolvedActiveIndex = optionKeys.indexOf(activeOptionKey);
  const activeIndex = resolvedActiveIndex >= 0 ? resolvedActiveIndex : 0;
  const totalItems = optionKeys.length;
  const setActiveIndex = (index: number) => {
    const optionKey = optionKeys[index];
    if (optionKey) setActiveOptionKey(optionKey);
  };

  useEffect(() => {
    setActiveOptionKey("action:new-chat");
  }, [query, open]);

  useEffect(() => {
    if (!open || totalItems === 0) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`command-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, open, totalItems]);

  const suppressFocusRestore = () => {
    shouldRestoreFocusRef.current = false;
  };

  const closePalette = () => {
    const returnTarget = returnFocusRef.current;
    const shouldRestore = shouldRestoreFocusRef.current;
    onClose();
    if (!shouldRestore) return;

    const restoreFocus = () => {
      const target = resolveReturnFocusTarget(returnTarget);
      if (target && document.activeElement !== target) {
        target.focus({ preventScroll: true });
      }
    };
    queueMicrotask(restoreFocus);
    window.setTimeout(restoreFocus, 0);
    window.requestAnimationFrame(() => {
      restoreFocus();
      window.requestAnimationFrame(restoreFocus);
    });
  };

  const chooseActive = () => {
    const action = actionItems[activeIndex];
    if (action === "new-chat") {
      onNewChat();
      closePalette();
      return;
    }
    if (action === "settings") {
      suppressFocusRestore();
      onOpenSettings();
      closePalette();
      return;
    }
    if (typeof action === "string" && action.startsWith("/")) {
      suppressFocusRestore();
      const next = [action, ...recentCommands.filter((item) => item !== action)].slice(0, 12);
      saveRecentCommands(next);
      platformEvents.publish("platform", "command.executed", { command: action });
      window.location.assign(action);
      closePalette();
      return;
    }
    if (action === "focus-input") {
      suppressFocusRestore();
      document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      platformEvents.publish("platform", "command.executed", { command: action });
      closePalette();
      return;
    }
    if (action === "theme") {
      applyThemeMode(document.documentElement.classList.contains("dark") ? "light" : "dark");
      platformEvents.publish("platform", "command.executed", { command: action });
      closePalette();
      return;
    }
    if (action === "search") {
      suppressFocusRestore();
      window.dispatchEvent(new CustomEvent("kova-open-search"));
      platformEvents.publish("platform", "command.executed", { command: action });
      closePalette();
      return;
    }
    if (!action) {
      const workspaceMatch = visibleWorkspaceItems[activeIndex - workspaceStartIndex];
      if (workspaceMatch) {
        suppressFocusRestore();
        platformEvents.publish("platform", "command.executed", {
          command: `workspace:${workspaceMatch.type}`,
        });
        window.location.assign(workspaceMatch.href);
        closePalette();
        return;
      }
      const match = conversationMatches[activeIndex - chatStartIndex];
      if (match) {
        if (archivedConversations.some((item) => item.id === match.conversation.id))
          onSelectArchived(match.conversation);
        else onSelectChat(match.conversation.id);
        closePalette();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      data-kova-shell-overlay=""
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-[max(.75rem,var(--safe-left),var(--safe-right))] pb-[var(--safe-bottom)] pt-[max(12vh,var(--safe-top))]"
      role="dialog"
      aria-modal="true"
      aria-label="Search workspace, chats, and actions"
      onKeyDown={(event) => {
        if (event.key === "Tab" && dialogRef.current) {
          const focusable = Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.offsetParent !== null);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (first && last && event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (first && last && !event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closePalette();
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex(Math.min(totalItems - 1, activeIndex + 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex(Math.max(0, activeIndex - 1));
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.altKey) {
            const command = actionItems[activeIndex];
            if (command && command !== "new-chat" && command !== "settings") {
              const next = pinnedCommands.includes(command)
                ? pinnedCommands.filter((item) => item !== command)
                : [command, ...pinnedCommands];
              savePinnedCommands(next);
              return;
            }
          }
          chooseActive();
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in duration-100">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search chats, apps, files, and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={`command-option-${activeIndex}`}
            aria-label="Search workspace, commands, and chats"
            className="h-10 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={closePalette}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
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
              closePalette();
            }}
            id="command-option-0"
            role="option"
            aria-selected={activeIndex === 0}
            className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === 0 ? "bg-accent" : ""}`}
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
              suppressFocusRestore();
              onOpenSettings();
              closePalette();
            }}
            id="command-option-1"
            role="option"
            aria-selected={activeIndex === 1}
            className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === 1 ? "bg-accent" : ""}`}
          >
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span>Open settings</span>
          </button>
          {visibleActions.map((action, actionIndex) => {
            const Icon = action.icon;
            const index = actionIndex + 2;
            const className = `flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === index ? "bg-accent" : ""} ${action.disabledReason ? "text-muted-foreground" : ""}`;
            const content = (
              <>
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{action.label}</span>
                {pinnedCommands.includes(action.href ?? action.action ?? "") ? (
                  <Star className="ml-auto h-3.5 w-3.5 fill-current" aria-label="Pinned command" />
                ) : null}
                {action.disabledReason ? (
                  <span className="text-[11px]">{action.disabledReason}</span>
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
                  onClick={() => {
                    suppressFocusRestore();
                    const next = [
                      action.href!,
                      ...recentCommands.filter((item) => item !== action.href),
                    ].slice(0, 12);
                    saveRecentCommands(next);
                    platformEvents.publish("platform", "command.executed", {
                      command: action.href,
                    });
                    closePalette();
                  }}
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
                onClick={() => {
                  const targetIndex = actionItems.indexOf(action.action);
                  if (targetIndex >= 0) setActiveIndex(targetIndex);
                  if (action.action === "focus-input") {
                    suppressFocusRestore();
                    document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
                    platformEvents.publish("platform", "command.executed", {
                      command: action.action,
                    });
                    closePalette();
                  } else if (action.action === "theme") {
                    applyThemeMode(
                      document.documentElement.classList.contains("dark") ? "light" : "dark",
                    );
                    platformEvents.publish("platform", "command.executed", {
                      command: action.action,
                    });
                    closePalette();
                  } else if (action.action === "search") {
                    suppressFocusRestore();
                    window.dispatchEvent(new CustomEvent("kova-open-search"));
                    platformEvents.publish("platform", "command.executed", {
                      command: action.action,
                    });
                    closePalette();
                  }
                }}
                className={className}
              >
                {content}
              </button>
            );
          })}

          <div className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">Workspace</div>
          {workspaceStatus === "loading" ? (
            <p role="status" className="min-h-11 px-3 py-2.5 text-sm text-muted-foreground">
              Searching workspace…
            </p>
          ) : null}
          {workspaceStatus === "error" ? (
            <div
              role="alert"
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-destructive"
            >
              <span>Workspace results are unavailable.</span>
              {retryWorkspaceSearch ? (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border px-3 text-foreground hover:bg-accent"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.stopPropagation();
                  }}
                  onClick={retryWorkspaceSearch}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {workspaceStatus === "ready" && visibleWorkspaceItems.length === 0 ? (
            <p className="min-h-11 px-3 py-2.5 text-sm text-muted-foreground">
              No workspace results
            </p>
          ) : null}
          {visibleWorkspaceItems.map((item, workspaceIndex) => {
            const index = workspaceStartIndex + workspaceIndex;
            return (
              <Link
                key={`${item.type}:${item.id}`}
                id={`command-option-${index}`}
                to={item.href as never}
                role="option"
                aria-selected={activeIndex === index}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => {
                  suppressFocusRestore();
                  platformEvents.publish("platform", "command.executed", {
                    command: `workspace:${item.type}`,
                  });
                  closePalette();
                }}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === index ? "bg-accent" : ""}`}
              >
                <Boxes className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.type}</span>
              </Link>
            );
          })}

          <div className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">Chats</div>
          {normalized ? null : (
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">
              Search message text or use is:pinned, has:attachment, in:title:, after:, and before:.
            </p>
          )}
          {conversationMatches.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No chats found
            </div>
          ) : (
            conversationMatches.map(({ conversation: chat, snippet }, chatIndex) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  if (archivedConversations.some((item) => item.id === chat.id))
                    onSelectArchived(chat);
                  else onSelectChat(chat.id);
                  closePalette();
                }}
                id={`command-option-${chatStartIndex + chatIndex}`}
                role="option"
                aria-selected={activeIndex === chatStartIndex + chatIndex}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent ${activeIndex === chatStartIndex + chatIndex ? "bg-accent" : ""}`}
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="hidden max-w-52 truncate text-xs text-muted-foreground sm:block">
                  {snippet}
                </span>
              </button>
            ))
          )}
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            Press Alt+Enter to pin or unpin the selected command.
          </p>
        </div>
      </div>
    </div>
  );
}
