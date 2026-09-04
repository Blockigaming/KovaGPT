import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Pencil, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { addToContextPack, continueInResearch, openInWork } from "@/lib/workspace-handoffs";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import {
  deleteMemoryRecord,
  listMemoryCenter,
  updateMemoryRecord,
  type MemoryRecord,
} from "@/lib/workspace.functions";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/memory")({
  component: MemoryPage,
  head: () => ({
    meta: [{ title: "KovaGPT Memory" }, { name: "robots", content: "noindex" }],
  }),
});

function memoryRecordKey(item: Pick<MemoryRecord, "id" | "source">) {
  return `${item.source}:${item.id}`;
}

function MemoryPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
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
  const [resolvedUserKey, setResolvedUserKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const currentUserKeyRef = useRef(userKey);
  currentUserKeyRef.current = userKey;

  useEffect(() => {
    if (!isLoaded) return;

    let active = true;
    setItems([]);
    setError(null);
    setQuery("");
    setSource("all");
    setEditing(null);
    setDraft("");
    setSelected([]);
    setDeleting(null);

    if (!isSignedIn || !userKey) {
      setResolvedUserKey(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setResolvedUserKey(null);
    list({})
      .then((nextItems) => {
        if (!active) return;
        setItems(nextItems);
        setResolvedUserKey(userKey);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Memory could not be loaded");
        setResolvedUserKey(userKey);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, list, reloadKey, userKey]);
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
    const operationUserKey = userKey;
    const content = draft.trim();
    if (!content) return;
    try {
      await update({ data: { id: item.id, source: item.source, content } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems((all) =>
        all.map((value) =>
          memoryRecordKey(value) === memoryRecordKey(item)
            ? { ...value, content, updatedAt: new Date().toISOString() }
            : value,
        ),
      );
      setEditing(null);
      toast.success("Memory updated");
    } catch (e) {
      if (currentUserKeyRef.current === operationUserKey) {
        toast.error(e instanceof Error ? e.message : "Memory could not be updated");
      }
    }
  };
  const del = async (item: MemoryRecord) => {
    const operationUserKey = userKey;
    try {
      await remove({ data: { id: item.id, source: item.source } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems((all) => all.filter((value) => memoryRecordKey(value) !== memoryRecordKey(item)));
      toast.success("Memory deleted");
    } catch (e) {
      if (currentUserKeyRef.current === operationUserKey) {
        toast.error(e instanceof Error ? e.message : "Memory could not be deleted");
      }
    } finally {
      if (currentUserKeyRef.current === operationUserKey) setDeleting(null);
    }
  };
  const merge = async () => {
    const operationUserKey = userKey;
    const chosen = items.filter((item) => selected.includes(memoryRecordKey(item)));
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
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems((all) =>
        all
          .filter(
            (item) =>
              !duplicates.some((duplicate) => memoryRecordKey(duplicate) === memoryRecordKey(item)),
          )
          .map((item) =>
            memoryRecordKey(item) === memoryRecordKey(keep) ? { ...item, content } : item,
          ),
      );
      setSelected([]);
      toast.success("Duplicate memories merged");
    } catch (reason) {
      if (currentUserKeyRef.current === operationUserKey) {
        toast.error(reason instanceof Error ? reason.message : "Memories could not be merged");
      }
    }
  };
  const isLoading =
    !isLoaded || Boolean(isSignedIn && (!userKey || loading || resolvedUserKey !== userKey));
  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        aria-busy={isLoading || undefined}
        className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6"
      >
        <WorkspacePageHeader
          icon={Brain}
          title="Memory Center"
          description="Review durable conversation summaries and project context. Temporary chats are never stored here."
        />
        {isSignedIn && !isLoading && !error ? (
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
            <div role="toolbar" aria-label="Filter memories by source" className="flex gap-1">
              {(["all", "conversation", "project"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={source === value}
                  onClick={() => setSource(value)}
                  className={`min-h-10 rounded-lg px-3 text-sm capitalize ${source === value ? "bg-foreground text-background" : "hover:bg-accent"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {isSignedIn && !isLoading && !error && selected.length > 0 ? (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
            <span>{selected.length} selected</span>
            <button
              type="button"
              onClick={merge}
              className="min-h-10 rounded-lg border bg-background px-3"
            >
              Merge duplicates
            </button>
          </div>
        ) : null}
        {isLoading ? (
          <section
            aria-busy="true"
            aria-labelledby="memory-loading-title"
            className="mt-6 space-y-3"
          >
            <h2 id="memory-loading-title" className="sr-only">
              Loading memories
            </h2>
            {[1, 2, 3].map((i) => (
              <div className="h-28 animate-pulse rounded-xl bg-muted" key={i} aria-hidden="true" />
            ))}
          </section>
        ) : !isSignedIn ? (
          <section
            className="mt-8 rounded-2xl border p-8 text-center"
            aria-labelledby="memory-sign-in-title"
          >
            <Brain className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h2 id="memory-sign-in-title" className="mt-3 text-lg font-semibold">
              Sign in to manage memory
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Review and edit the durable context KovaGPT can reuse in future conversations.
            </p>
            <SignInButton mode="modal">
              <Button className="mt-5">Sign in</Button>
            </SignInButton>
          </section>
        ) : error ? (
          <section role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            <h2 className="font-medium">Memory could not be loaded</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your saved memories are temporarily unavailable. Try again in a moment.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Try again
            </Button>
          </section>
        ) : visible.length === 0 ? (
          <section
            className="rounded-2xl border p-10 text-center"
            aria-labelledby="memory-empty-title"
          >
            <Brain className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <h2 id="memory-empty-title" className="mt-3 font-semibold">
              {query || source !== "all" ? "No matching memories" : "No memories yet"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {query || source !== "all"
                ? "Try a different search or show all memory sources."
                : "Memory is created only from eligible non-temporary conversations and project context."}
            </p>
            {query || source !== "all" ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setQuery("");
                  setSource("all");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </section>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <li key={`${item.source}:${item.id}`} className="rounded-2xl border bg-card/40 p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    aria-label={`Select ${item.title} for merging`}
                    checked={selected.includes(memoryRecordKey(item))}
                    onChange={() =>
                      setSelected((all) => {
                        const key = memoryRecordKey(item);
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
                    {editing === memoryRecordKey(item) ? (
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label={`Memory content for ${item.title}`}
                        className="mt-3 min-h-28 w-full rounded-xl border bg-background p-3"
                      />
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end">
                    <button
                      onClick={() =>
                        openInWork(
                          {
                            type: "memory",
                            id: item.id,
                            title: item.title,
                            content: item.content,
                          },
                          userKey,
                        )
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Work
                    </button>
                    <button
                      onClick={() =>
                        continueInResearch(
                          {
                            type: "memory",
                            id: item.id,
                            title: item.title,
                            content: item.content,
                          },
                          userKey,
                        )
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Research
                    </button>
                    <button
                      onClick={() =>
                        addToContextPack(
                          {
                            type: "memory",
                            id: item.id,
                            title: item.title,
                            content: item.content,
                          },
                          userKey,
                        )
                      }
                      className="min-h-11 rounded-lg px-2 text-xs hover:bg-accent"
                    >
                      Context
                    </button>
                    {editing === memoryRecordKey(item) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => save(item)}
                          disabled={!draft.trim()}
                          className="min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setDraft("");
                          }}
                          className="min-h-11 rounded-lg px-3 text-sm hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(memoryRecordKey(item));
                          setDraft(item.content);
                        }}
                        aria-label={`Edit ${item.title}`}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
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
        {isSignedIn && !isLoading && !error ? (
          <aside className="mt-8 rounded-2xl bg-muted/50 p-4 text-sm">
            <strong>How memory is used</strong>
            <p className="mt-1 text-muted-foreground">
              Relevant saved context may be included with a future prompt. Retrieved connector data
              is temporary context, not durable memory. Disable cross-chat memory in Settings at any
              time.
            </p>
          </aside>
        ) : null}
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
