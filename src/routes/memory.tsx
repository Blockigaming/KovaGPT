import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Brain, Pencil, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { addToContextPack, continueInResearch, openInWork } from "@/lib/workspace-handoffs";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  deleteMemoryRecord,
  listMemoryCenter,
  updateMemoryRecord,
  type MemoryRecord,
} from "@/lib/workspace.functions";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
export const Route = createFileRoute("/memory")({
  component: MemoryPage,
  head: () => ({
    meta: [{ title: "Memory Center | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
function MemoryPage() {
  const { isLoaded, isSignedIn } = useUser();
  const list = useServerFn(listMemoryCenter);
  const update = useServerFn(updateMemoryRecord);
  const remove = useServerFn(deleteMemoryRecord);
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | MemoryRecord["source"]>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<MemoryRecord | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    list({})
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Memory could not be loaded"))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list]);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (source === "all" || item.source === source) &&
          `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query, source],
  );
  const save = async (item: MemoryRecord) => {
    try {
      await update({ data: { id: item.id, source: item.source, content: draft } });
      setItems((all) =>
        all.map((value) =>
          value.id === item.id
            ? { ...value, content: draft, updatedAt: new Date().toISOString() }
            : value,
        ),
      );
      setEditing(null);
      toast.success("Memory updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Memory could not be updated");
    }
  };
  const del = async (item: MemoryRecord) => {
    try {
      await remove({ data: { id: item.id, source: item.source } });
      setItems((all) => all.filter((value) => value.id !== item.id));
      toast.success("Memory deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Memory could not be deleted");
    } finally {
      setDeleting(null);
    }
  };
  const merge = async () => {
    const chosen = items.filter((item) => selected.includes(`${item.source}:${item.id}`));
    if (chosen.length < 2 || new Set(chosen.map((item) => item.source)).size !== 1) {
      toast.error("Select at least two memories from the same source category");
      return;
    }
    const [keep, ...duplicates] = chosen;
    const content = [...new Set(chosen.map((item) => item.content.trim()))].join("\n\n");
    try {
      await update({ data: { id: keep.id, source: keep.source, content } });
      await Promise.all(
        duplicates.map((item) => remove({ data: { id: item.id, source: item.source } })),
      );
      setItems((all) =>
        all
          .filter((item) => !duplicates.some((duplicate) => duplicate.id === item.id))
          .map((item) => (item.id === keep.id ? { ...item, content } : item)),
      );
      setSelected([]);
      toast.success("Duplicate memories merged");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Memories could not be merged");
    }
  };
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={Brain}
          title="Memory Center"
          description="Review durable conversation summaries and project context. Temporary chats are never stored here."
        />
        <div className="my-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="relative">
            <span className="sr-only">Search memories</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-xl border bg-background pl-9"
              placeholder="Search memories"
            />
          </label>
          <div role="tablist" className="flex gap-1">
            {(["all", "conversation", "project"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={source === value}
                onClick={() => setSource(value)}
                className={`min-h-10 rounded-lg px-3 text-sm capitalize ${source === value ? "bg-foreground text-background" : "hover:bg-accent"}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {selected.length > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
            <span>{selected.length} selected</span>
            <button onClick={merge} className="min-h-10 rounded-lg border bg-background px-3">
              Merge duplicates
            </button>
          </div>
        )}
        {!isSignedIn && !loading ? (
          <div className="rounded-2xl border p-8 text-center">
            Sign in to manage account memory.
          </div>
        ) : loading ? (
          <div aria-label="Loading memories" className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div className="h-28 animate-pulse rounded-xl bg-muted" key={i} />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 p-4">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center">
            <Brain className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No memories found</h2>
            <p className="text-sm text-muted-foreground">
              Memory is created only from eligible non-temporary conversations and project context.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <li key={`${item.source}:${item.id}`} className="rounded-2xl border bg-card/40 p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    aria-label={`Select ${item.title} for merging`}
                    checked={selected.includes(`${item.source}:${item.id}`)}
                    onChange={() =>
                      setSelected((all) => {
                        const key = `${item.source}:${item.id}`;
                        return all.includes(key)
                          ? all.filter((value) => value !== key)
                          : [...all, key];
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{item.title}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {item.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.source} source · Updated {new Date(item.updatedAt).toLocaleString()}
                    </p>
                    {editing === item.id ? (
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="mt-3 min-h-28 w-full rounded-xl border bg-background p-3"
                      />
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end">
                    <button
                      onClick={() =>
                        openInWork({
                          type: "memory",
                          id: item.id,
                          title: item.title,
                          content: item.content,
                        })
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Work
                    </button>
                    <button
                      onClick={() =>
                        continueInResearch({
                          type: "memory",
                          id: item.id,
                          title: item.title,
                          content: item.content,
                        })
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Research
                    </button>
                    <button
                      onClick={() =>
                        addToContextPack({
                          type: "memory",
                          id: item.id,
                          title: item.title,
                          content: item.content,
                        })
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Context
                    </button>
                    {editing === item.id ? (
                      <button
                        onClick={() => save(item)}
                        className="min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-accent"
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setEditing(item.id);
                          setDraft(item.content);
                        }}
                        aria-label={`Edit ${item.title}`}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleting(item)}
                      aria-label={`Delete ${item.title}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <aside className="mt-8 rounded-2xl bg-muted/50 p-4 text-sm">
          <strong>How memory is used</strong>
          <p className="mt-1 text-muted-foreground">
            Relevant saved context may be included with a future prompt. Retrieved connector data is
            temporary context, not durable memory. Disable cross-chat memory in Settings at any
            time.
          </p>
        </aside>
      </main>
      <ConfirmActionDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this memory?"
        description="This saved memory will no longer be available as context. This cannot be undone."
        confirmLabel="Delete memory"
        destructive
        onConfirm={() => deleting && void del(deleting)}
      />
    </AppShell>
  );
}
