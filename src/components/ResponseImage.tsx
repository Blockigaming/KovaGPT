import { useEffect, useRef, useState } from "react";
import { Bookmark, Download, Check } from "lucide-react";
import { ExpandViewIcon } from "./ui/ExpandViewIcon";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { ChatImage, type ChatImageActions } from "./ChatImage";
import { downloadChatImage } from "@/lib/chat-image-actions";

export function ResponseImage({
  src,
  alt,
  onSave,
  imageActions,
}: {
  src: string;
  alt: string;
  onSave?: (src: string, title: string) => Promise<void>;
  imageActions?: ChatImageActions;
}) {
  const [full, setFull] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const viewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadChatImage(src, () => alive.current);
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : "Couldn’t download the image.");
    } finally {
      if (alive.current) setDownloading(false);
    }
  };
  return (
    <ChatImage
      src={src}
      alt={alt}
      actions={imageActions}
      className="kova-response-image"
      onHide={() => setFull(false)}
    >
      {alt && (
        <span className="kova-image-hover-detail" aria-hidden="true">
          {alt}
        </span>
      )}
      <span className="kova-image-actions">
        {onSave && (
          <button
            type="button"
            disabled={saving || saved}
            aria-busy={saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              setError(null);
              try {
                await onSave(src, alt);
                if (alive.current) setSaved(true);
              } catch (error) {
                if (alive.current)
                  setError(error instanceof Error ? error.message : "Couldn’t save the image.");
              } finally {
                if (alive.current) setSaving(false);
              }
            }}
          >
            {!saving && (saved ? <Check /> : <Bookmark />)}
            {saved ? (
              "Saved to Library"
            ) : saving ? (
              <span className="spec400-loading-label">
                <span className="spec400-loading-spinner" aria-hidden="true" />
                <span className="kova-image-busy-label">Saving…</span>
              </span>
            ) : (
              "Save to Library"
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          aria-busy={downloading}
        >
          {downloading ? (
            <span className="spec400-loading-label">
              <span className="spec400-loading-spinner" aria-hidden="true" />
              <span className="kova-image-busy-label">Downloading…</span>
            </span>
          ) : (
            <>
              <Download />
              Download
            </>
          )}
        </button>
        <button ref={viewButton} type="button" onClick={() => setFull(true)}>
          <ExpandViewIcon />
          View full size
        </button>
      </span>
      {error && (
        <span role="alert" className="block text-sm text-destructive">
          {error}
        </span>
      )}
      {full && (
        <Dialog
          open
          onOpenChange={(open) => {
            setFull(open);
            if (!open) setZoomed(false);
          }}
        >
          <DialogContent
            constrainToViewport={false}
            data-kova-response-image-view=""
            className="sm:max-w-[92vw]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (viewButton.current?.isConnected)
                viewButton.current.focus({ preventScroll: true });
            }}
          >
            <DialogTitle>{alt}</DialogTitle>
            <button
              type="button"
              className="kova-image-zoom"
              aria-pressed={zoomed}
              onClick={() => setZoomed((value) => !value)}
            >
              Zoom image
            </button>
            <div
              className="kova-image-view-scroll"
              data-zoomed={zoomed}
              role="region"
              aria-label="Image preview"
              tabIndex={zoomed ? 0 : undefined}
            >
              <ChatImage
                src={src}
                alt={alt}
                actions={imageActions}
                imageClassName="max-h-[70dvh] w-auto max-w-full object-contain"
                onHide={() => {
                  setZoomed(false);
                  setFull(false);
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </ChatImage>
  );
}
