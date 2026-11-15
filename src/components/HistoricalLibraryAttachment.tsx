import { useRef, useState } from "react";
import {
  AttachmentPreviewAsk,
  AttachmentPreviewFileInfo,
  AttachmentPreviewMobileHeader,
} from "./AttachmentPreviewMobile";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { FileText, Loader2 } from "lucide-react";
import type { Attachment } from "@/lib/chat-store";
import { useHistoricalLibraryAvailability } from "@/hooks/use-historical-library-availability";

export function HistoricalLibraryAttachment({
  attachment,
  ownerId,
  onAsk,
  onOpenPane,
}: {
  attachment: Extract<Attachment, { kind: "library_file" }>;
  ownerId: string | null;
  onOpenPane?: () => void;
  onAsk?: (prompt: string) => boolean;
}) {
  const { elementRef, status, retry } = useHistoricalLibraryAvailability(
    ownerId,
    attachment.libraryItemId,
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label =
    status === "loading"
      ? "Loading…"
      : status === "unavailable"
        ? "File unavailable"
        : status === "unknown"
          ? "Availability unknown"
          : "Library";
  return (
    <span
      ref={elementRef}
      className="inline-flex min-h-10 max-w-full flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/55 px-3 py-2 text-xs text-foreground"
      title={attachment.name}
      data-library-availability={status}
    >
      <button
        ref={trigger}
        type="button"
        className="inline-flex min-h-11 min-w-0 items-center gap-2"
        aria-haspopup="dialog"
        data-attachment-preview-trigger=""
        onClick={() => {
          onOpenPane?.();
          setOpen(true);
        }}
      >
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="max-w-48 truncate">{attachment.name}</span>
      </button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen} attachmentPreview>
          <DialogContent
            attachmentPreview
            className="spec400-attachment-preview kova-preview-mobile-file"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus({ preventScroll: true });
            }}
          >
            <DialogHeader className="kova-preview-mobile-description">
              <DialogTitle>{attachment.name}</DialogTitle>
              <DialogDescription>{label}</DialogDescription>
            </DialogHeader>
            <AttachmentPreviewMobileHeader
              title={attachment.name}
              actions={
                <a href="/library" className="kova-preview-action inline-flex items-center">
                  Open Library
                </a>
              }
            />
            <div className="kova-preview-file-stage">
              <AttachmentPreviewFileInfo name={attachment.name} size={attachment.size} />
              <p className="kova-preview-desktop-actions">
                <a href="/library" className="underline">
                  Open Library
                </a>
              </p>
              {status !== "available" && (
                <p className="text-center text-sm text-muted-foreground">{label}</p>
              )}
            </div>
            {status === "available" && onAsk && (
              <AttachmentPreviewAsk
                onAsk={(prompt) => {
                  if (!onAsk(prompt)) return false;
                  setOpen(false);
                  return true;
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
        {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {label}
      </span>
      {ownerId && (status === "unknown" || status === "unavailable") && (
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={retry}
          aria-label={`Check availability of ${attachment.name}`}
        >
          Check again
        </button>
      )}
    </span>
  );
}
