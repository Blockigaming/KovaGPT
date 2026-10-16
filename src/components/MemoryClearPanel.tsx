import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  changeMemoryClear,
  memoryClearAvailability,
  type MemoryClearReceipt,
} from "@/lib/memory-clear.functions";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type Entry = {
  id: string;
  receipt?: MemoryClearReceipt;
  error?: string;
  retry?: "clear" | "restore" | "dismiss";
};
export function MemoryClearPanel({
  ownerId,
  disabled,
  onBusy,
  onChanged,
}: {
  ownerId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: (isCurrent: () => boolean) => Promise<void>;
}) {
  const availability = useServerFn(memoryClearAvailability),
    change = useServerFn(changeMemoryClear);
  const [windowSeconds, setWindowSeconds] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(false),
    generation = useRef(0),
    activeOwner = useRef<string | null>(ownerId);
  activeOwner.current = ownerId;
  const renderGeneration = generation.current;
  useEffect(() => {
    activeOwner.current = ownerId;
    const epoch = ++generation.current;
    pending.current = false;
    setBusy(false);
    onBusy(false);
    setEntries([]);
    setWindowSeconds(null);
    setNotice("");
    const current = () => activeOwner.current === ownerId && generation.current === epoch;
    void availability()
      .then((result) => {
        if (current()) setWindowSeconds(result.available ? result.seconds : null);
      })
      .catch(() => {});
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, ownerId)) return;
      generation.current += 1;
      setEntries([]);
      setNotice("");
      setBusy(false);
      pending.current = false;
      onBusy(false);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      activeOwner.current = null;
      generation.current += 1;
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [ownerId, availability, onBusy]);
  const run = async (entry: Entry, action: "clear" | "restore" | "dismiss", keepNewer = false) => {
    if (
      pending.current ||
      disabled ||
      activeOwner.current !== ownerId ||
      generation.current !== renderGeneration
    )
      return;
    const epoch = generation.current,
      principal = ownerId;
    const current = () => activeOwner.current === principal && generation.current === epoch;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setNotice("");
    try {
      const receipt = await change({
        data: {
          operationId: entry.id,
          action,
          keepNewer,
          ...(keepNewer ? { conflictToken: entry.receipt?.conflictToken } : {}),
        },
      });
      if (!current()) return;
      setEntries((all) =>
        all.map((value) => (value.id === entry.id ? { id: entry.id, receipt } : value)),
      );
      if (receipt.state !== "conflict") {
        try {
          await onChanged(current);
        } catch {
          if (current())
            setNotice(
              "The operation was confirmed, but the list could not refresh. Review latest memories before editing.",
            );
        }
      }
    } catch {
      if (current())
        setEntries((all) =>
          all.map((value) =>
            value.id === entry.id
              ? {
                  ...value,
                  retry: action,
                  error:
                    "Outcome not confirmed. Retry this same entry; it will not clear newer additions twice.",
                }
              : value,
          ),
        );
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const clear = () => {
    if (
      disabled ||
      pending.current ||
      !windowSeconds ||
      activeOwner.current !== ownerId ||
      generation.current !== renderGeneration
    )
      return;
    const epoch = generation.current;
    if (
      !window.confirm(
        "Clear ALL saved cross-chat memories, including those outside this filter? A temporary recovery copy will be retained for Undo. Project context, conversations, and same-chat summaries stay unchanged.",
      )
    )
      return;
    if (activeOwner.current !== ownerId || generation.current !== epoch) return;
    const entry = { id: crypto.randomUUID() };
    setEntries((all) => [...all, entry]);
    void run(entry, "clear");
  };
  const button = "min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50";
  return (
    <section className="my-4 space-y-2 rounded-xl border p-3" aria-label="Reversible memory clear">
      <p className="text-sm">
        Clear saved cross-chat memories with scoped Undo. This is separate from permanent deletion
        in Settings. Project context and conversations are not cleared.
      </p>
      <p className="text-xs text-muted-foreground">
        {windowSeconds
          ? `Undo window: ${windowSeconds} seconds. Recovery entries are available only while this page stays open; leaving, switching accounts, or resetting this browser removes these controls. Temporary recovery data expires separately on the server.`
          : "Reversible clear is unavailable until recovery storage, retention, and cleanup are configured."}
      </p>
      <button
        type="button"
        className={button}
        disabled={
          disabled ||
          busy ||
          !windowSeconds ||
          entries.some((entry) => !entry.receipt || entry.retry === "clear")
        }
        onClick={clear}
      >
        Clear saved chat memories
      </button>
      {notice && <p role="status">{notice}</p>}
      <ol className="space-y-3">
        {entries.map((entry, index) => (
          <li key={entry.id} className="space-y-2">
            <p role="status">
              Clear {index + 1}:{" "}
              {entry.receipt
                ? `${entry.receipt.removedCount} removed; ${entry.receipt.state === "active" ? `Undo expires at ${entry.receipt.expiresAt}` : entry.receipt.state === "conflict" ? `${entry.receipt.conflictCount} newer records conflict; no restoration applied` : entry.receipt.state === "restored" ? `${entry.receipt.restoredCount} restored, ${entry.receipt.skippedCount} newer records kept` : entry.receipt.state}`
                : "Awaiting confirmation"}
            </p>
            {entry.error && <p role="alert">{entry.error}</p>}
            <div className="flex flex-wrap gap-2">
              {entry.retry && (
                <button
                  type="button"
                  className={button}
                  disabled={disabled || busy}
                  onClick={() => void run(entry, entry.retry!)}
                >
                  Retry {entry.retry}
                </button>
              )}
              {!entry.retry && entry.receipt?.state === "active" && (
                <button
                  type="button"
                  className={button}
                  disabled={disabled || busy}
                  onClick={() => void run(entry, "restore")}
                >
                  Undo clear {index + 1}
                </button>
              )}
              {entry.receipt?.state === "conflict" && (
                <>
                  <button
                    type="button"
                    className={button}
                    disabled={disabled || busy}
                    onClick={() => void run(entry, "restore", true)}
                  >
                    Keep newer records and restore the rest
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      setEntries((all) =>
                        all.map((value) =>
                          value.id === entry.id
                            ? { id: entry.id, receipt: { ...entry.receipt!, state: "active" } }
                            : value,
                        ),
                      )
                    }
                  >
                    Cancel restoration
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
