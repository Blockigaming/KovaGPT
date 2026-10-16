import { MemoryClearPanel } from "@/components/MemoryClearPanel";
import { useCollectionPager } from "@/lib/use-collection-pager";
import { CollectionPageControls } from "@/components/CollectionPageControls";
import { MEMORY_SOURCES_CHANGED_EVENT } from "@/lib/memory-sources.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Pencil, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { addToContextPack, continueInChat, openInWork } from "@/lib/workspace-handoffs";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import {
  deleteMemoryRecord,
  listMemoryCenter,
  mergeMemoryRecords,
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
  const { isLoaded, user } = useUser();
  return <MemoryForAccount key={isLoaded ? (user?.id ?? "guest") : "loading"} />;
}
function MemoryForAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const listPage = useServerFn(listMemoryCenter);
  const update = useServerFn(updateMemoryRecord);
  const remove = useServerFn(deleteMemoryRecord);
  const mergeRecords = useServerFn(mergeMemoryRecords);
  const mutationPending = useRef(false);
  const [mutating, setMutating] = useState(false);
  const clearBusy = useCallback((busy: boolean) => {
    mutationPending.current = busy;
    setMutating(busy);
  }, []);
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const pager = useCollectionPager(listPage, userKey, setItems);
  const list = pager.read;
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
  useEffect(
    () => () => {
      currentUserKeyRef.current = null;
    },
    [],
  );

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
    list()
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
    if (!content || mutationPending.current) return;
    mutationPending.current = true;
    pager.invalidate();
    setMutating(true);
    try {
      const saved = await update({
        data: { id: item.id, source: item.source, content, expectedContent: item.content },
      });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems((all) =>
        all.map((value) =>
          memoryRecordKey(value) === memoryRecordKey(item)
            ? { ...value, content: saved.content, updatedAt: saved.updatedAt }
            : value,
        ),
      );
      setEditing(null);
      window.dispatchEvent(new Event(MEMORY_SOURCES_CHANGED_EVENT));
      toast.success("Memory updated");
    } catch (e) {
      if (currentUserKeyRef.current === operationUserKey) {
        toast.error(e instanceof Error ? e.message : "Memory could not be updated");
      }
    } finally {
      mutationPending.current = false;
      if (currentUserKeyRef.current === operationUserKey) setMutating(false);
    }
  };
  const del = async (item: MemoryRecord) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    pager.invalidate();
    setMutating(true);
    const operationUserKey = userKey;
    try {
      await remove({ data: { id: item.id, source: item.source, expectedContent: item.content } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems((all) => all.filter((value) => memoryRecordKey(value) !== memoryRecordKey(item)));
      window.dispatchEvent(new Event(MEMORY_SOURCES_CHANGED_EVENT));
      toast.success("Memory deleted");
    } catch (e) {
      if (currentUserKeyRef.current === operationUserKey) {
        toast.error(e instanceof Error ? e.message : "Memory could not be deleted");
      }
    } finally {
      mutationPending.current = false;
      if (currentUserKeyRef.current === operationUserKey) {
        setDeleting(null);
        setMutating(false);
      }
    }
  };
  const merge = async () => {
    if (mutationPending.current) return;
    const operationUserKey = userKey;
    const chosen = items.filter((item) => selected.includes(memoryRecordKey(item)));
    if (
      chosen.length < 2 ||
      chosen.length > 30 ||
      new Set(chosen.map((item) => item.source)).size !== 1 ||
      (chosen[0]?.source === "project" && new Set(chosen.map((item) => item.projectId)).size !== 1)
    ) {
      toast.error("Select 2–30 memories from the same source and project");
      return;
    }
    if (editing && chosen.some((item) => memoryRecordKey(item) === editing)) {
      toast.error("Save or cancel the selected memory edit before merging.");
      return;
    }
    mutationPending.current = true;
    pager.invalidate();
    setMutating(true);
    try {
      const result = await mergeRecords({
        data: {
          source: chosen[0].source,
          items: chosen.map(({ id, content }) => ({ id, content })),
        },
      });
      if (currentUserKeyRef.current !== operationUserKey) return;
      const source = chosen[0].source;
      setItems((all) =>
        all
          .filter((item) => item.source !== source || !result.removedIds.includes(item.id))
          .map((item) =>
            item.source === source && item.id === result.id
              ? { ...item, content: result.content }
              : item,
          ),
      );
      setSelected([]);
      window.dispatchEvent(new Event(MEMORY_SOURCES_CHANGED_EVENT));
      toast.success("Duplicate memories merged");
    } catch (reason) {
      if (currentUserKeyRef.current === operationUserKey)
        toast.error(reason instanceof Error ? reason.message : "Memories could not be merged");
    } finally {
      mutationPending.current = false;
      if (currentUserKeyRef.current === operationUserKey) setMutating(false);
    }
  };
  const reviewLatest = async () => {
    if (mutationPending.current || !userKey) return;
    const operationUserKey = userKey;
    mutationPending.current = true;
    pager.invalidate();
    setMutating(true);
    try {
      const latest = await pager.readCurrent();
      if (currentUserKeyRef.current !== operationUserKey) return;
      setItems(latest);
      toast.success("Latest saved memories loaded. Your draft is preserved; review before saving.");
    } catch (reason) {
      if (currentUserKeyRef.current === operationUserKey)
        toast.error(reason instanceof Error ? reason.message : "Memory could not be reviewed");
    } finally {
      mutationPending.current = false;
      if (currentUserKeyRef.current === operationUserKey) setMutating(false);
    }
  };
  const isLoading =
    !isLoaded || Boolean(isSignedIn && (!userKey || loading || resolvedUserKey !== userKey));
  return (
    <AppShell utilitiesInHeader>
      <main
        id="main-content"
        tabIndex={-1}
        aria-busy={isLoading || undefined}
        className="kova-workspace-controls mx-auto w-full max-w-4xl px-4 py-7 sm:px-6"
      >
        <WorkspacePageHeader
          icon={Brain}
          title="Memory Center"
          description="Review durable conversation summaries and project context. Temporary chats are never stored here."
        />
        {isSignedIn && userKey && !isLoading && !error && (
          <MemoryClearPanel
            ownerId={userKey}
            disabled={mutating || Boolean(editing) || Boolean(deleting)}
            onBusy={clearBusy}
            onChanged={async (isCurrent) => {
              const principal = userKey;
              pager.invalidate();
              const latest = await pager.readCurrent();
              if (currentUserKeyRef.current !== principal || !isCurrent()) return;
              setItems(latest);
              setSelected([]);
              window.dispatchEvent(new Event(MEMORY_SOURCES_CHANGED_EVENT));
            }}
          />
        )}
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
        {isSignedIn && !isLoading && !error && (
          <button
            onClick={reviewLatest}
            disabled={mutating}
            className="mb-3 min-h-10 rounded-lg border px-3 text-sm"
          >
            Review latest memories
          </button>
        )}
        {isSignedIn && !isLoading && !error && selected.length > 0 ? (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
            <span>{selected.length} selected</span>
            <button
              type="button"
              onClick={merge}
              disabled={mutating}
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
              {query || source !== "all" ? "No matching memories" : "No memories on this page"}
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
                    disabled={mutating || pager.busy}
                    className="mt-1 h-4 w-4"
                    aria-label={`Select ${item.title} for merging`}
                    checked={selected.includes(memoryRecordKey(item))}
                    onChange={() => {
                      if (pager.isLoading() || mutationPending.current) return;
                      setSelected((all) => {
                        const key = memoryRecordKey(item);
                        return all.includes(key)
                          ? all.filter((value) => value !== key)
                          : [...all, key];
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{item.title}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {item.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.source} source · {item.source === "project" ? "Added" : "Updated"}{" "}
                      {new Date(item.updatedAt).toLocaleString()}
                    </p>
                    {editing === memoryRecordKey(item) ? (
                      <div>
                        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          Latest saved content: {item.content}
                        </p>
                        <textarea
                          autoFocus
                          disabled={mutating}
                          maxLength={2000}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          aria-label={`Memory content for ${item.title}`}
                          className="mt-3 min-h-28 w-full rounded-xl border bg-background p-3"
                        />
                      </div>
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
                        continueInChat(
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
                      Ask Kova
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
                          disabled={mutating || !draft.trim()}
                          className="min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={mutating}
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
                          if (pager.isLoading() || mutationPending.current) return;
                          setEditing(memoryRecordKey(item));
                          setDraft(item.content);
                        }}
                        disabled={mutating || pager.busy || editing !== null}
                        aria-label={`Edit ${item.title}`}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleting(item)}
                      disabled={mutating}
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
        {isSignedIn && !isLoading && !error && (
          <CollectionPageControls
            label="Memories (conversation pages, then project pages)"
            pager={pager}
            disabled={mutating || editing !== null || selected.length > 0}
          />
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
