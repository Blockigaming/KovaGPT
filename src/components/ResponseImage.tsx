import { useEffect, useRef, useState } from "react";
import { Bookmark, Download, Maximize2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

export function ResponseImage({
  src,
  alt,
  onSave,
}: {
  src: string;
  alt: string;
  onSave?: (src: string, title: string) => Promise<void>;
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
      const response = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok)
        throw new Error(
          "The image could not be downloaded. Open it full size to save it manually.",
        );
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp|gif)$/i.test(blob.type))
        throw new Error(
          "This image format cannot be downloaded here. Open it full size to save it manually.",
        );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `generated-image.${blob.type.split("/")[1] === "jpeg" ? "jpg" : blob.type.split("/")[1]}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : "Couldn’t download the image.");
    } finally {
      if (alive.current) setDownloading(false);
    }
  };
  return (
    <span className="kova-response-image">
      <img src={src} alt={alt} loading="lazy" />
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
            <img src={src} alt={alt} className="max-h-[75dvh] w-auto max-w-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </span>
  );
}
