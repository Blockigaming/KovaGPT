import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  customRetention,
  DEFAULT_TRASH_RETENTION_MS,
  retentionPreview,
  TRASH_RETENTION_OPTIONS,
  type TrashState,
} from "@/lib/chat-trash-policy.mjs";
import {
  readChatTrash,
  restoreChatTrash,
  sweepChatTrash,
  trashStorageKey,
  TRASH_CHANGED_EVENT,
  writeChatTrash,
} from "@/lib/chat-trash";

/** Browser-only recoverable Trash until a server retention contract is available. */
export function ChatTrashPanel({ userKey }: { userKey: string | null }) {
  const ownerRef = useRef({ owner: userKey, generation: 0 });
  if (ownerRef.current.owner !== userKey)
    ownerRef.current = { owner: userKey, generation: ownerRef.current.generation + 1 };
  const [view, setView] = useState<{ owner: string | null; state: TrashState } | null>(null);
  const [choice, setChoice] = useState(String(DEFAULT_TRASH_RETENTION_MS));
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState("days");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    kind: "retention" | "delete";
    owner: string | null;
    generation: number;
    duration?: number;
    id?: string;
    affected: { id: string; title: string }[];
  } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const state = view?.owner === userKey ? view.state : null;
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      if (!mounted) return;
      try {
        const state = pendingRef.current ? readChatTrash(userKey) : sweepChatTrash(userKey);
        setView({ owner: userKey, state });
        setError("");
      } catch {
        setError(
          "Trash storage is unavailable. No changes were made. Try again when browser storage is available.",
        );
      }
    };
    try {
      const initial = readChatTrash(userKey);
      const preset = TRASH_RETENTION_OPTIONS.some((option) => option.value === initial.retentionMs);
      setChoice(preset ? String(initial.retentionMs) : "custom");
      setAmount(String(initial.retentionMs / 60_000));
      setUnit("minutes");
    } catch {
      /* refresh reports storage failures */
    }
    setMessage("");
    setPending(null);
    setBusy(false);
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === trashStorageKey(userKey) || event.key === null) refresh();
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent).detail?.owner === userKey) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener(TRASH_CHANGED_EVENT, onChange);
    return () => {
      mounted = false;
      ownerRef.current.generation += 1;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(TRASH_CHANGED_EVENT, onChange);
    };
  }, [userKey]);
  const save = () => {
    try {
      const duration = choice === "custom" ? customRetention(amount, unit) : Number(choice);
      const preview = retentionPreview(readChatTrash(userKey), duration, Date.now());
      if (preview.requiresConfirmation) {
        openerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPending({
          kind: "retention",
          owner: userKey,
          generation: ownerRef.current.generation,
          duration,
          affected: preview.expired.map((entry) => ({
            id: entry.conversation.id,
            title: entry.conversation.title || "Untitled chat",
          })),
        });
        return;
      }
      writeChatTrash(userKey, preview.next);
      setError("");
      setMessage("Trash retention saved for this browser.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save retention.");
    }
  };
  const restore = async (id: string) => {
    const trigger = document.activeElement;
    let restored = false;
    const owner = userKey;
    const generation = ownerRef.current.generation;
    const current = () =>
      ownerRef.current.owner === owner && ownerRef.current.generation === generation;
    setBusy(true);
    try {
      const ok = await restoreChatTrash(owner, id, current);
      if (current()) {
        restored = ok;
        setMessage(
          ok
            ? "Chat restored to your history."
            : "Could not restore this chat. It may have expired; refresh Trash and try again.",
        );
      }
    } catch {
      if (current()) setError("Could not restore this chat. Your Trash copy has been kept.");
    } finally {
      if (current()) {
        setBusy(false);
        if (restored)
          window.requestAnimationFrame(() => {
            if (
              !current() ||
              (document.activeElement !== document.body && document.activeElement !== trigger)
            )
              return;
            const next = panelRef.current?.querySelector<HTMLButtonElement>(
              "[data-trash-restore]:not(:disabled)",
            );
            (next ?? panelRef.current)?.focus();
          });
      }
    }
  };
  const permanentlyDelete = (id: string) => {
    const entry = state?.entries.find((item) => item.conversation.id === id);
    if (!entry) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError("");
    setPending({
      kind: "delete",
      owner: userKey,
      generation: ownerRef.current.generation,
      id,
      affected: [{ id, title: entry.conversation.title || "Untitled chat" }],
    });
  };
  const confirmPending = () => {
    if (
      !pending ||
      pending.owner !== userKey ||
      pending.generation !== ownerRef.current.generation
    ) {
      setPending(null);
      return;
    }
    try {
      const latest = readChatTrash(userKey);
      if (pending.kind === "retention") {
        const preview = retentionPreview(latest, pending.duration!, Date.now());
        const affected = preview.expired.map((entry) => ({
          id: entry.conversation.id,
          title: entry.conversation.title || "Untitled chat",
        }));
        if (JSON.stringify(affected) !== JSON.stringify(pending.affected)) {
          setPending({ ...pending, affected });
          setError(
            "Trash changed while this confirmation was open. Review the updated list and confirm again.",
          );
          return;
        }
        writeChatTrash(userKey, preview.next);
        setMessage("Trash retention saved for this browser.");
      } else {
        writeChatTrash(userKey, {
          ...latest,
          entries: latest.entries.filter((entry) => entry.conversation.id !== pending.id),
        });
        setMessage("Chat permanently removed from this browser’s Trash.");
      }
      setError("");
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this change. Try again.");
    }
  };
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="chat-trash-heading"
      className="space-y-4 py-4"
    >
      <div>
        <h3 id="chat-trash-heading" className="text-sm font-medium">
          Trash
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Deleted chats can be restored here until they expire. Archive is separate and has no Trash
          expiry.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Trash and this retention setting are saved only in this browser. Expired copies are
          removed when Trash is opened or this window regains focus. Scheduled server deletion and
          cross-device Trash are not available yet. Clearing browser data removes these recoverable
          copies. Guest data lasts only for the current session.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Delete chats in Trash after
          <Select value={choice} onValueChange={setChoice} disabled={!state || busy}>
            <SelectTrigger aria-label="Trash retention" className="min-h-11 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRASH_RETENTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {choice === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              Duration
              <input
                aria-label="Custom Trash duration"
                inputMode="decimal"
                className="h-11 w-24 rounded-md border border-border bg-background px-2 text-sm"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Unit
              <Select value={unit} onValueChange={setUnit} disabled={busy}>
                <SelectTrigger aria-label="Custom Trash duration unit" className="min-h-11 w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </>
        )}
        <Button variant="outline" size="sm" onClick={save} disabled={!state || busy}>
          Save retention
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Default: one month (30 days). Changes apply from each chat’s original deletion time. Custom
        duration: 1 minute to 3,650 days.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {state?.entries.length === 0 && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Trash is empty.
        </p>
      )}
      <ul className="max-h-80 space-y-2 overflow-y-auto">
        {state?.entries.map((entry) => (
          <li key={entry.conversation.id} className="rounded-lg border border-border p-3">
            <p className="truncate text-sm font-medium">
              {entry.conversation.title || "Untitled chat"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Deleted {new Date(entry.deletedAt).toLocaleString()} · Expires{" "}
              {new Date(entry.expiresAt).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                data-trash-restore
                onClick={() => void restore(entry.conversation.id)}
              >
                Restore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={busy}
                onClick={() => permanentlyDelete(entry.conversation.id)}
              >
                Delete permanently
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <AlertDialog
        open={pending !== null && pending.owner === userKey}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = openerRef.current;
            if (target?.isConnected) target.focus();
            else panelRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "retention"
                ? "Change Trash retention?"
                : "Delete chat permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "retention" && pending.duration === 0
                ? "Future deleted chats will bypass Trash. "
                : ""}
              {pending?.affected.length ?? 0} chat(s) will be permanently removed from this
              browser’s Trash. This cannot be undone. Drafts are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 overflow-y-auto text-sm list-disc pl-5">
            {pending?.affected.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmPending}>
              {pending?.kind === "retention" ? "Confirm retention change" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
