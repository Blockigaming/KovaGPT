import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readMemorySources } from "@/lib/memory-sources.functions";
import {
  normalizeMemorySources,
  MEMORY_SOURCES_CHANGED_EVENT,
  type MemorySources,
} from "@/lib/memory-sources.mjs";
import { createMemorySourceInspection } from "@/lib/memory-source-inspection.mjs";
import { PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT } from "@/lib/principal-browser-storage.mjs";
import type { InspectedMemorySource } from "@/lib/memory-sources.server.mjs";

const PAGE_SIZE = 10;
export function MemorySourcesDialog({
  sources,
  onClose,
}: {
  sources: MemorySources;
  onClose: () => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const permitted = normalizeMemorySources(sources, ownerId);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    entries: InspectedMemorySource[];
    error: string | null;
  } | null>(null);
  const read = useServerFn(readMemorySources);
  const loader = useMemo(() => createMemorySourceInspection((data) => read({ data })), [read]);
  const key = `${ownerId}:${JSON.stringify(sources)}:${page}:${refresh}`;
  const keyRef = useRef(key);
  keyRef.current = permitted ? key : "";
  useEffect(() => {
    setResult(null);
    if (!permitted) return;
    void loader
      .load({
        ownerId: permitted.ownerId,
        sources: permitted.sources.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      })
      .then((value) => {
        if (value && keyRef.current === key) setResult({ key, ...value });
      });
    return () => loader.invalidate();
    // The serialized request key includes the complete source list and current account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loader]);
  useEffect(() => {
    const clear = () => {
      loader.invalidate();
      setResult(null);
      setRefresh((value) => value + 1);
    };
    const conceal = () => {
      loader.invalidate();
      setResult(null);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") conceal();
      else clear();
    };
    window.addEventListener("focus", clear);
    window.addEventListener("blur", conceal);
    window.addEventListener(MEMORY_SOURCES_CHANGED_EVENT, clear);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onClose);
    document.addEventListener("visibilitychange", hide);
    return () => {
      loader.invalidate();
      window.removeEventListener("focus", clear);
      window.removeEventListener("blur", conceal);
      window.removeEventListener(MEMORY_SOURCES_CHANGED_EVENT, clear);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, onClose);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [loader, onClose]);
  const current = permitted && result?.key === key ? result : null;
  return (
    <Dialog
      open={Boolean(permitted)}
      onOpenChange={(open) => {
        if (!open) {
          loader.invalidate();
          setResult(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Memory provided</DialogTitle>
          <DialogDescription>
            These sources were included with the original response request. This does not tell us
            which facts influenced the answer or later edits. The current saved contents appear
            below and may have changed since that response.
          </DialogDescription>
        </DialogHeader>
        {!current ? (
          <p role="status">Checking access to saved memory…</p>
        ) : current.error ? (
          <p role="alert">{current.error}</p>
        ) : (
          <ul className="space-y-4">
            {current.entries.map((entry) => (
              <li key={`${entry.kind}:${entry.id}`} className="rounded-lg border p-3">
                {entry.available ? (
                  <>
                    <h3 className="text-sm font-medium">{entry.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {entry.content}
                    </p>
                    {entry.truncated && (
                      <p className="mt-2 text-xs">Showing the first 6,000 characters.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This source was deleted or is no longer available to your account.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
            className="disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page + 1} of{" "}
            {Math.max(1, Math.ceil((permitted?.sources.length ?? 0) / PAGE_SIZE))}
          </span>
          <button
            type="button"
            disabled={(page + 1) * PAGE_SIZE >= (permitted?.sources.length ?? 0)}
            onClick={() => setPage((value) => value + 1)}
            className="disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => {
              loader.invalidate();
              setResult(null);
              setRefresh((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
