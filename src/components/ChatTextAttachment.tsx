import { useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@/lib/chat-store";
import { attachmentPreviewWindow, summarizeLocalPaste } from "@/lib/composer-local-attachments.mjs";
import {
  AttachmentPreviewAsk,
  AttachmentPreviewFileInfo,
  AttachmentPreviewMobileHeader,
} from "./AttachmentPreviewMobile";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function ChatTextAttachment({
  attachment,
  onAsk,
  onOpenPane,
}: {
  attachment: Extract<Attachment, { kind: "text_file" }>;
  onOpenPane?: () => void;
  onAsk?: (prompt: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = attachmentPreviewWindow(attachment.content, offset);
  const title = useMemo(
    () =>
      attachment.name === "pasted-text.txt"
        ? summarizeLocalPaste(attachment.content)
        : attachment.name,
    [attachment.name, attachment.content],
  );
  const downloadText = () => {
    const url = URL.createObjectURL(new Blob([attachment.content], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = /\.txt$/i.test(attachment.name) ? attachment.name : attachment.name + ".txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const actions = (
    <>
      <button
        type="button"
        className="kova-preview-action"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(attachment.content);
            toast.success("Text copied");
          } catch {
            toast.error("Could not copy the text.");
          }
        }}
      >
        Copy text
      </button>
      <button type="button" className="kova-preview-action" onClick={downloadText}>
        Download text
      </button>
    </>
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        data-attachment-preview-trigger=""
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[var(--kova-radius-panel)] border border-border/70 bg-muted/55 px-3 py-2 text-xs text-foreground hover:bg-muted"
        onClick={() => {
          onOpenPane?.();
          setOffset(0);
          setOpen(true);
        }}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="max-w-48 truncate">{title}</span>
      </button>
      <Dialog attachmentPreview open={open} onOpenChange={setOpen}>
        <DialogContent
          attachmentPreview
          className="spec400-attachment-preview kova-preview-mobile-file"
          closeLabel="Close preview"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="kova-preview-mobile-description">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {attachment.fileType && !attachment.fileType.startsWith("text/")
                ? "Extracted text"
                : "Text preview"}
            </DialogDescription>
          </DialogHeader>
          <AttachmentPreviewMobileHeader title={title} actions={actions} />
          <div className="kova-preview-desktop-actions kova-text-viewer-tools">{actions}</div>
          <div className="kova-preview-file-stage">
            {attachment.name !== "pasted-text.txt" && (
              <AttachmentPreviewFileInfo name={attachment.name} size={attachment.size} />
            )}
            {preview.total > 0 && (
              <p className="spec400-preview-range">
                Characters {preview.start + 1}–{preview.end} of {preview.total.toLocaleString()}
              </p>
            )}
            <pre className="spec400-bounded-preview kova-preview-paginated-text" tabIndex={0}>
              {preview.text}
            </pre>
            {preview.total > 4_000 && (
              <div className="spec400-preview-pages" role="group" aria-label="Text preview pages">
                <button
                  type="button"
                  className="kova-preview-action"
                  disabled={preview.start === 0}
                  onClick={() => setOffset(Math.max(0, preview.start - 4_000))}
                >
                  Previous text
                </button>
                <button
                  type="button"
                  className="kova-preview-action"
                  disabled={preview.end >= preview.total}
                  onClick={() => setOffset(preview.end)}
                >
                  Next text
                </button>
              </div>
            )}
            <pre className="kova-preview-continuous-text" tabIndex={0}>
              {attachment.content}
            </pre>
          </div>
          {onAsk && (
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
    </>
  );
}
