import { useEffect, useState } from "react";
import { ArchiveRestore, Search, Trash2, X } from "lucide-react";
import {
  loadArchivedConversations,
  removeArchivedConversation,
  saveArchivedConversations,
  type Conversation,
} from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export function ArchivedChatsDialog({
  open,
  onClose,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (conversation: Conversation) => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setItems(loadArchivedConversations());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  const visible = query.trim()
    ? searchConversations(items, query).map((result) => result.conversation)
    : items;
  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-black/35 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archived-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="max-h-[85dvh] w-full max-w-xl overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-2 border-b p-4">
          <ArchiveRestore className="h-4 w-4" />
          <div>
            <h2 id="archived-title" className="font-semibold">
              Archived chats
            </h2>
            <p className="text-xs text-muted-foreground">
              Restore a conversation or delete it permanently from this device.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-2" aria-label="Close archived chats">
            <X className="h-4 w-4" />
          </button>
        </header>
        {items.length > 0 && (
          <div className="flex justify-end border-b px-3 py-2">
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDeleteAllOpen(true)}
            >
              Delete all archived
            </button>
          </div>
        )}
        <label className="relative m-3 block">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Search archived chats</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles or message content"
            className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm"
          />
        </label>
        <ul className="max-h-[60dvh] overflow-y-auto px-3 pb-3">
          {visible.map((chat) => (
            <li key={chat.id} className="flex items-center gap-2 border-t py-2 first:border-0">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{chat.title}</strong>
                <span className="text-xs text-muted-foreground">
                  {chat.messages.length} messages · {new Date(chat.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <button
                onClick={() => {
                  removeArchivedConversation(chat.id);
                  onRestore(chat);
                  setItems((all) => all.filter((item) => item.id !== chat.id));
                }}
                className="p-2"
                aria-label={`Restore ${chat.title}`}
                title="Restore"
              >
                <ArchiveRestore className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  removeArchivedConversation(chat.id);
                  setItems((all) => all.filter((item) => item.id !== chat.id));
                }}
                className="p-2 text-destructive"
                aria-label={`Permanently delete ${chat.title}`}
                title="Delete permanently"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        {!visible.length ? (
          <p className="px-4 pb-8 text-center text-sm text-muted-foreground">
            {query ? "No archived chats match this search." : "No archived chats."}
          </p>
        ) : null}
      </section>
      <ConfirmActionDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title="Delete all archived chats?"
        description={`This permanently removes ${items.length} archived chat${items.length === 1 ? "" : "s"} from this device. This cannot be undone.`}
        confirmLabel="Delete all"
        destructive
        onConfirm={() => {
          saveArchivedConversations([]);
          setItems([]);
        }}
      />
    </div>
  );
}
