import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  SELECTED_LIBRARY_DOWNLOAD_LIMIT,
  startSelectedLibraryDownload,
  type SelectedLibraryDownload,
  type SelectedLibraryDownloads,
} from "@/lib/library-selected-downloads";

type Receipt = { phase: "loading" | "started" | "error"; message?: string };

export function LibrarySelectedDownloadsDialog({
  snapshot,
  owner,
  isCurrent,
  onClose,
  onCloseAutoFocus,
}: {
  snapshot: SelectedLibraryDownloads;
  owner: string | null;
  isCurrent: () => boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const statusRefs = useRef(new Map<string, HTMLParagraphElement>());
  const currentRef = useRef(isCurrent);
  currentRef.current = isCurrent;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  const current = () => active.current && currentRef.current();
  const close = () => {
    active.current = false;
    pending.current?.abort();
    onClose();
  };
  const download = async (entry: SelectedLibraryDownload) => {
    if (!current() || pending.current || !entry.kind || snapshot.overLimit) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusyId(entry.item.id);
    setReceipts((previous) => ({ ...previous, [entry.item.id]: { phase: "loading" } }));
    // Move off the soon-disabled button once, on explicit activation. Terminal updates
    // change this stable status in place and never reclaim focus from another control.
    statusRefs.current.get(entry.item.id)?.focus({ preventScroll: true });
    try {
      await startSelectedLibraryDownload(owner, entry, controller.signal, current);
      if (current() && !controller.signal.aborted)
        setReceipts((previous) => ({ ...previous, [entry.item.id]: { phase: "started" } }));
    } catch (cause) {
      if (current() && !controller.signal.aborted)
        setReceipts((previous) => ({
          ...previous,
          [entry.item.id]: {
            phase: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "The download could not start. Please retry.",
          },
        }));
    } finally {
      if (pending.current === controller) pending.current = null;
      if (current()) setBusyId(null);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} closeLabel="Close selected downloads">
        <DialogTitle className="pr-10">Download selected files</DialogTitle>
        <DialogDescription>
          {snapshot.overLimit
            ? `${snapshot.count} items selected. Choose up to ${SELECTED_LIBRARY_DOWNLOAD_LIMIT} items, then open Download again. Nothing has been downloaded.`
            : `${snapshot.count} selected · ${snapshot.eligibleCount} eligible · ${snapshot.unsupportedCount} unsupported. Start each download individually. Files are limited to 10 MB, or 8 MB for images.`}
        </DialogDescription>
        <p className="text-sm text-muted-foreground">
          Your selection stays unchanged. “Download started” means the file was handed to your
          browser; check your browser’s downloads to confirm it was saved.
        </p>
        {!snapshot.overLimit && (
          <ul className="grid gap-3" aria-label="Selected file downloads">
            {snapshot.entries.map((entry) => {
              const receipt = receipts[entry.item.id];
              return (
                <li key={entry.item.id} className="grid min-w-0 gap-2 rounded-xl border p-3">
                  <p className="break-words text-sm font-medium">{entry.item.title}</p>
                  {entry.item.file_name && (
                    <p className="break-words text-xs text-muted-foreground">
                      {entry.item.file_name}
                    </p>
                  )}
                  {entry.kind ? (
                    <Button
                      className="min-h-11 justify-self-start"
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      aria-label={`${receipt?.phase === "error" ? "Retry download" : "Download"} ${entry.item.title}`}
                      onClick={() => void download(entry)}
                    >
                      {busyId === entry.item.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="mr-2 h-5 w-5" aria-hidden="true" />
                      )}
                      {busyId === entry.item.id
                        ? "Preparing file…"
                        : receipt?.phase === "error"
                          ? "Retry download"
                          : "Download file"}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">Unsupported: {entry.reason}</p>
                  )}
                  <p
                    ref={(element) => {
                      if (element) statusRefs.current.set(entry.item.id, element);
                      else statusRefs.current.delete(entry.item.id);
                    }}
                    tabIndex={-1}
                    role={receipt?.phase === "error" ? "alert" : "status"}
                    className="rounded text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {receipt?.phase === "loading"
                      ? "Checking access and preparing this file…"
                      : receipt?.phase === "started"
                        ? "Download started"
                        : receipt?.message}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <Button className="min-h-11" variant="outline" onClick={close}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
