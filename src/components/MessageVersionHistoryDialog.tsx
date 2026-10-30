import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { acceptMessageVersion, listMessageVersions } from "@/lib/chat-workspace.functions";
import { localVersions, saveLocalVersion } from "@/lib/local-chat-workspace.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";
import { ResponseVersionDiff } from "./ResponseVersionDiff";

type Entry = {
  id: string;
  version: number;
  content: string;
  instruction: string | null;
  createdAt: string;
  durable: boolean;
};

/**
 * Version history for one message. Restoring a prior version never deletes
 * newer ones — for signed-in users the restore is recorded server-side, so the
 * whole chain stays inspectable.
 */
export function MessageVersionHistoryDialog({
  open,
  onOpenChange,
  chatId,
  messageId,
  currentContent,
  onRestore,
  compareInitially = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId?: string | null;
  messageId?: string | null;
  currentContent: string;
  onRestore: (content: string) => void;
  compareInitially?: boolean;
}) {
  const { isSignedIn } = useUser();
  const listFn = useServerFn(listMessageVersions);
  const acceptFn = useServerFn(acceptMessageVersion);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!chatId || !messageId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn) {
        const rows = await listFn({ data: { chatId, messageId } });
        setEntries(
          rows.map((row) => ({
            id: row.id,
            version: row.version,
            content: row.content,
            instruction: row.instruction,
            createdAt: row.createdAt,
            durable: true,
          })),
        );
      } else {
        setEntries(
          localVersions(safeBrowserStorage("localStorage"), chatId, messageId).map((row) => ({
            id: row.id,
            version: row.version,
            content: row.content,
            instruction: row.instruction,
            createdAt: row.createdAt,
            durable: false,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Version history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [chatId, isSignedIn, listFn, messageId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);
  useEffect(() => {
    if (open && compareInitially)
      setExpanded(
        [...entries].reverse().find((entry) => entry.content !== currentContent)?.id ?? null,
      );
  }, [compareInitially, currentContent, entries, open]);

  const restore = useCallback(
    async (entry: Entry) => {
      setRestoring(entry.id);
      setError(null);
      try {
        if (entry.durable) await acceptFn({ data: { versionId: entry.id } });
        else if (chatId && messageId)
          saveLocalVersion(safeBrowserStorage("localStorage"), chatId, messageId, {
            content: entry.content,
            originalContent: currentContent,
            source: "restore",
            instruction: `Restored version ${entry.version}`,
          });
        onRestore(entry.content);
        toast.success(
          entry.durable ? `Restored version ${entry.version}` : "Restored from this device",
        );
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That version could not be restored.");
      } finally {
        setRestoring(null);
      }
    },
    [acceptFn, onOpenChange, onRestore, chatId, messageId, currentContent],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {compareInitially ? "Compare response versions" : "Version history"}
          </DialogTitle>
          <DialogDescription>
            {isSignedIn
              ? "Saved edits for this response, newest last."
              : "Edits saved on this device. Sign in to keep history with your account."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
          </p>
        ) : error ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved edits for this response yet. Select text in the answer and choose “Edit
            selection” to create one.
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {entries.map((entry) => {
              const isCurrent = entry.content === currentContent;
              return (
                <li key={entry.id} className="rounded-xl border border-border bg-card/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Version {entry.version}
                        {isCurrent ? " · shown now" : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                        {entry.durable ? " · saved to this chat" : " · this device only"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                        className="text-muted-foreground"
                        aria-expanded={expanded === entry.id}
                      >
                        {expanded === entry.id ? "Hide preview" : "Preview version"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void restore(entry)}
                        disabled={restoring !== null || isCurrent || expanded !== entry.id}
                        aria-busy={restoring === entry.id}
                      >
                        {restoring === entry.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Restore
                      </Button>
                    </div>
                  </div>
                  {entry.instruction && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Instruction: {entry.instruction}
                    </p>
                  )}
                  {expanded === entry.id && (
                    <div className="max-h-72 overflow-y-auto">
                      <ResponseVersionDiff before={entry.content} after={currentContent} />
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">
                          Full previous version
                        </summary>
                        <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2 text-xs font-sans">
                          {entry.content}
                        </pre>
                      </details>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
