import { useEffect, useState } from "react";
import { ArchiveRestore, Search, Trash2, X } from "lucide-react";
import {
  chatStoragePrincipal,
  loadConversations,
  saveConversations,
  loadArchivedConversations,
  removeArchivedConversation,
  saveArchivedConversations,
  type Conversation,
} from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";
import { useUser } from "@/components/auth/ClerkSafe";

export function ArchivedChatsDialog({
  open,
  onClose,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (conversation: Conversation) => void;
}) {
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const [archiveState, setArchiveState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const items =
    principal !== null && archiveState.principal === principal ? archiveState.items : [];
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    if (!isLoaded || principal === null) {
      setArchiveState({ principal: null, items: [] });
      return;
    }
    setArchiveState({ principal, items: loadArchivedConversations(userKey) });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLoaded, onClose, open, principal, userKey]);
  if (!open) return null;
  const visible = query.trim()
    ? searchConversations(items, query).map((result) => result.conversation)
    : items;
  return (
    <div
      data-slot="archived-chats-overlay"
      className="fixed inset-0 z-[85] flex items-end justify-center bg-[var(--surface-scrim)] [font-family:var(--font-ui,var(--font-sans))] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archived-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        data-slot="archived-chats-content"
        className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[var(--kova-radius-panel)] border border-border bg-popover pb-[var(--safe-bottom)] text-popover-foreground shadow-[var(--shadow-floating)] sm:rounded-[var(--kova-radius-panel)] sm:pb-0"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border p-4 sm:p-6">
          <ArchiveRestore className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2
              id="archived-title"
              className="text-2xl font-normal leading-tight [font-family:var(--font-display,Georgia,serif)]"
            >
              Archived chats
            </h2>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Restore a conversation or delete it permanently from this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close archived chats"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {items.length > 0 && (
          <div className="flex shrink-0 justify-end border-b border-border px-4 py-2 sm:px-6">
            <button
              type="button"
              className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={async () => {
                if (!window.confirm(`Permanently delete all ${items.length} archived chats?`))
                  return;
                if (!(await saveArchivedConversations(userKey, []))) return;
                setArchiveState({ principal, items: [] });
              }}
            >
              Delete all archived
            </button>
          </div>
        )}
        <label className="relative m-4 block shrink-0 sm:mx-6">
          <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
          <span className="sr-only">Search archived chats</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles or message content"
            className="min-h-11 w-full rounded-[var(--kova-radius-input)] border border-border bg-background pl-10 pr-4 text-sm"
          />
        </label>
        <ul className="min-h-0 max-h-[60dvh] flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6">
          {visible.map((chat) => (
            <li key={chat.id} className="flex items-center gap-3 border-t py-2 first:border-0">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{chat.title}</strong>
                <span className="text-xs text-muted-foreground">
                  {chat.messages.length} messages · {new Date(chat.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <button
                onClick={async () => {
                  if (
                    !(await saveConversations(userKey, [
                      chat,
                      ...loadConversations(userKey).filter((c) => c.id !== chat.id),
                    ])) ||
                    !(await removeArchivedConversation(userKey, chat.id))
                  )
                    return;
                  onRestore(chat);
                  setArchiveState((current) =>
                    current.principal === principal
                      ? {
                          principal,
                          items: current.items.filter((item) => item.id !== chat.id),
                        }
                      : current,
                  );
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Restore ${chat.title}`}
                title="Restore"
              >
                <ArchiveRestore className="h-5 w-5" />
              </button>
              <button
                onClick={async () => {
                  if (!(await removeArchivedConversation(userKey, chat.id))) return;
                  setArchiveState((current) =>
                    current.principal === principal
                      ? {
                          principal,
                          items: current.items.filter((item) => item.id !== chat.id),
                        }
                      : current,
                  );
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Permanently delete ${chat.title}`}
                title="Delete permanently"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
        {!visible.length ? (
          <p className="shrink-0 px-4 pb-8 text-center text-sm text-muted-foreground">
            {query ? "No archived chats match this search." : "No archived chats."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
