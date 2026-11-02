import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { listMemoryCenter, type MemoryRecord } from "@/lib/workspace.functions";
import { MEMORY_SOURCES_CHANGED_EVENT } from "@/lib/memory-sources.mjs";

export function MemoryOverview({
  ownerId,
  automaticMemory = false,
}: {
  ownerId: string | null;
  automaticMemory?: boolean;
}) {
  const list = useServerFn(listMemoryCenter);
  const [state, setState] = useState<{
    owner: string | null;
    items: MemoryRecord[];
    error: boolean;
  }>({ owner: null, items: [], error: false });
  useEffect(() => {
    if (!ownerId) return;
    let active = true,
      generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const items = await list({});
        if (active && request === generation) setState({ owner: ownerId, items, error: false });
      } catch {
        if (active && request === generation) setState({ owner: ownerId, items: [], error: true });
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", visible);
    window.addEventListener(MEMORY_SOURCES_CHANGED_EVENT, visible);
    const timer = window.setInterval(visible, 30000);
    return () => {
      active = false;
      generation++;
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener(MEMORY_SOURCES_CHANGED_EVENT, visible);
    };
  }, [ownerId, list]);
  const current = state.owner === ownerId ? state : null;
  return (
    <section
      className="rounded-3xl border border-border bg-muted/20 p-5"
      aria-label="Saved memory summary"
    >
      <h3 className="font-medium">What Kova remembers</h3>
      <div className="my-3 space-y-2 text-sm text-muted-foreground">
        {!ownerId
          ? "Sign in to review your memory."
          : !current
            ? "Loading your memory…"
            : current.error
              ? "Memory couldn't be loaded. Reopen this tab to retry."
              : !current.items.length
                ? automaticMemory
                  ? "No saved notes yet. Preferences and facts you share in synced chats will appear here automatically."
                  : "No saved notes yet. Turn on conversation updates, or save a reviewed memory from a chat."
                : current.items.slice(0, 3).map((item) => (
                    <p key={`${item.source}:${item.id}`} className="whitespace-pre-wrap">
                      {item.content.slice(0, 220)}
                      {item.content.length > 220 ? "…" : ""}
                    </p>
                  ))}
      </div>
      <Link
        to="/memory"
        className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-medium"
      >
        Review and edit memory
      </Link>
    </section>
  );
}
