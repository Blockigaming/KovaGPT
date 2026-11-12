import { useState, type ReactNode } from "react";
import { ArrowUp, Download, Ellipsis, Archive, FileText, X } from "lucide-react";
import { DialogClose } from "./ui/dialog";
import { formatStorageBytes } from "@/lib/storage-display";

export function AttachmentPreviewMobileHeader({
  title,
  actions,
  onDownload,
  onShare,
  busy,
}: {
  title?: string;
  actions: ReactNode;
  onDownload?: () => void;
  onShare?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="kova-preview-mobile-header">
      <DialogClose className="kova-preview-circle" aria-label="Close preview">
        <X aria-hidden="true" />
      </DialogClose>
      {title && <span className="kova-preview-mobile-title">{title}</span>}
      <div className="kova-preview-mobile-tools">
        <details className="kova-preview-more">
          <summary className="kova-preview-circle" aria-label="More options">
            <Ellipsis aria-hidden="true" />
          </summary>
          <div className="kova-preview-more-actions">{actions}</div>
        </details>
        {onDownload && (
          <button
            type="button"
            className="kova-preview-circle"
            aria-label="Download image"
            onClick={onDownload}
            disabled={busy}
          >
            <Download aria-hidden="true" />
          </button>
        )}
        {onShare && (
          <button type="button" className="kova-preview-share" onClick={onShare} disabled={busy}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}

export function AttachmentPreviewFileInfo({ name, size }: { name: string; size?: number | null }) {
  const extension = name.split(".").length > 1 ? name.split(".").at(-1)?.toUpperCase() : undefined;
  const Icon = extension === "ZIP" ? Archive : FileText;
  return (
    <div className="kova-preview-file-info">
      <div className="kova-preview-file-icon" aria-hidden="true">
        <Icon />
        <span>{extension && extension.length <= 8 ? extension : "FILE"}</span>
      </div>
      <p>{name}</p>
      {size != null && <small>{formatStorageBytes(size)}</small>}
    </div>
  );
}

export function AttachmentPreviewAsk({
  onAsk,
  placeholder = "Ask KovaGPT",
}: {
  onAsk: (prompt: string) => boolean;
  placeholder?: string;
}) {
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className="kova-preview-ask"
      onSubmit={(event) => {
        event.preventDefault();
        if (prompt.trim() && onAsk(prompt.trim())) setPrompt("");
      }}
    >
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <button
        type="submit"
        className="kova-preview-circle"
        aria-label="Send question"
        disabled={!prompt.trim()}
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </form>
  );
}
