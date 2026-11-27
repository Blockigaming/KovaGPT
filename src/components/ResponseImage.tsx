import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { chatKeyFromScope, registerConversationImage } from "@/lib/conversation-images";

const ImageCanvasView = lazy(() =>
  import("./ImageCanvasView").then((module) => ({ default: module.ImageCanvasView })),
);
import { Bookmark, Download, Check } from "lucide-react";
import { ExpandViewIcon } from "./ui/ExpandViewIcon";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { ChatImage, type ChatImageActions } from "./ChatImage";
import { ResponseSpriteExport } from "./ResponseSpriteExport";
import { useMobileImageGestures } from "@/hooks/use-mobile-image-gestures";
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
  const [spriteOpen, setSpriteOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const zoomed = zoom > 100;
  const gestures = useMobileImageGestures(zoom, setZoom);
  const [canvas, setCanvas] = useState(false);
  const chat = imageActions ? chatKeyFromScope(imageActions.scope) : null;
  useEffect(() => (chat ? registerConversationImage(chat, src, alt) : undefined), [chat, src, alt]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const spriteButton = useRef<HTMLButtonElement>(null);
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
        <button ref={spriteButton} type="button" onClick={() => setSpriteOpen(true)}>
          GIF or sticker pack
        </button>
      </span>
      {error && (
        <span role="alert" className="block text-sm text-destructive">
          {error}
        </span>
      )}
      {spriteOpen && (
        <Dialog open onOpenChange={setSpriteOpen}>
          <DialogContent
            className="max-h-[85dvh] overflow-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              spriteButton.current?.focus({ preventScroll: true });
            }}
          >
            <DialogTitle>GIF or sticker pack</DialogTitle>
            <ResponseSpriteExport key={src} src={src} title={alt} />
          </DialogContent>
        </Dialog>
      )}
      {full && (
        <Dialog
          open
          onOpenChange={(open) => {
            setFull(open);
            if (!open) {
              setZoom(100);
              setCanvas(false);
            }
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
            {chat && (
              <div className="kova-image-view-tabs" role="group" aria-label="Image view">
                <button type="button" aria-pressed={!canvas} onClick={() => setCanvas(false)}>
                  Focused
                </button>
                <button type="button" aria-pressed={canvas} onClick={() => setCanvas(true)}>
                  All images
                </button>
              </div>
            )}
            {canvas && chat ? (
              <Suspense fallback={<p role="status">Loading images…</p>}>
                <ImageCanvasView chat={chat} current={src} />
              </Suspense>
            ) : (
              <>
                <button
                  type="button"
                  className="kova-image-zoom"
                  aria-pressed={zoomed}
                  onClick={() => setZoom((value) => (value > 100 ? 100 : 200))}
                >
                  Zoom image
                </button>
                <div
                  className="kova-image-view-scroll"
                  data-zoomed={zoomed}
                  {...gestures}
                  style={{ "--image-zoom-width": `${zoom}%` } as CSSProperties}
                  role="region"
                  aria-label="Image preview"
                  tabIndex={zoomed ? 0 : undefined}
                >
                  <ChatImage
                    src={src}
                    alt={alt}
                    actions={imageActions}
                    enablePreview={false}
                    imageClassName="max-h-[70dvh] w-auto max-w-full object-contain"
                    onHide={() => {
                      setZoom(100);
                      setFull(false);
                    }}
                  />
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </ChatImage>
  );
}
