import { useEffect, useRef, useState } from "react";
import { Bookmark, Download, Maximize2, Check } from "lucide-react";
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
      <span className="kova-image-actions">
        {onSave && (
          <button
            type="button"
            disabled={saving || saved}
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
            {saved ? <Check /> : <Bookmark />}
            {saved ? (
              "Saved to Library"
            ) : saving ? (
              <span className="spec400-loading-label">
                <span className="spec400-loading-spinner" aria-hidden="true" />
                Saving…
              </span>
            ) : (
              "Save to Library"
            )}
          </button>
        )}
        <button type="button" onClick={() => void download()} disabled={downloading}>
          <Download />
          {downloading ? "Downloading…" : "Download"}
        </button>
        <button ref={viewButton} type="button" onClick={() => setFull(true)}>
          <Maximize2 />
          View full size
        </button>
      </span>
      {error && (
        <span role="alert" className="block text-sm text-destructive">
          {error}
        </span>
      )}
      {full && (
        <Dialog open onOpenChange={setFull}>
          <DialogContent
            className="sm:max-w-[92vw]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (viewButton.current?.isConnected)
                viewButton.current.focus({ preventScroll: true });
            }}
          >
            <DialogTitle>{alt}</DialogTitle>
            <ChatImage
              src={src}
              alt={alt}
              actions={imageActions}
              imageClassName="max-h-[75dvh] w-auto max-w-full object-contain"
              onHide={() => setFull(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </ChatImage>
  );
}
