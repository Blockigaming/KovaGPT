import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { clampImageView, type ImageView } from "@/lib/image-viewer-geometry";

/** A touch-first viewer; all image operations remain explicit user actions. */
export default function ChatImageViewer({
  src,
  alt,
  onClose,
  onDownload,
  onReturnFocus,
  onShare,
  onPrepareEdit,
  busy = false,
  instructions,
  onInstructionsChange,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onDownload: () => void;
  onReturnFocus: () => void;
  onShare?: () => void;
  onPrepareEdit?: (instructions: string) => void;
  busy?: boolean;
  instructions: string;
  onInstructionsChange: (value: string) => void;
}) {
  const [visibleViewport, setVisibleViewport] = useState<{ height: number; top: number } | null>(
    null,
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      setVisibleViewport(
        viewport && window.innerWidth < 1024
          ? { height: viewport.height, top: viewport.offsetTop }
          : null,
      );
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const reset = () => setView({ scale: 1, x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  function bounded(view: ImageView) {
    const canvas = canvasRef.current,
      image = imageRef.current;
    return canvas && image
      ? clampImageView(
          view,
          { width: image.clientWidth, height: image.clientHeight },
          { width: canvas.clientWidth, height: canvas.clientHeight },
        )
      : view;
  }
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onPinchWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setView((current) => {
        const delta = event.deltaY < 0 ? 0.25 : -0.25;
        const scale = Math.min(5, Math.max(1, current.scale + delta));
        const image = imageRef.current;
        if (!image) return { ...current, scale };
        return clampImageView(
          { ...current, scale },
          { width: image.clientWidth, height: image.clientHeight },
          { width: canvas.clientWidth, height: canvas.clientHeight },
        );
      });
    };
    canvas.addEventListener("wheel", onPinchWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onPinchWheel);
  }, []);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const previous = useRef<{ x: number; y: number; distance: number } | null>(null);
  function geometry() {
    const values = [...points.current.values()];
    if (!values.length) return null;
    const a = values[0],
      b = values[1] ?? a;
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: values.length > 1 ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
    };
  }
  function zoom(delta: number) {
    setView((v) => {
      const scale = Math.min(5, Math.max(1, v.scale + delta));
      return bounded({ ...v, scale });
    });
  }
  const control =
    "min-h-12 min-w-12 rounded-full px-3 text-sm font-medium hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/95" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          aria-describedby={undefined}
          className="fixed inset-0 z-[120] flex h-[100dvh] min-w-0 flex-col bg-black text-white outline-none lg:inset-x-[8vw] lg:inset-y-[6dvh] lg:h-[88dvh] lg:rounded-2xl"
          style={{
            height: visibleViewport?.height,
            top: visibleViewport?.top,
            bottom: visibleViewport ? "auto" : undefined,
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <Dialog.Title className="sr-only">Image preview</Dialog.Title>
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
            <button className={control} type="button" onClick={onDownload}>
              Save image
            </button>
            {onShare && (
              <button className={control} type="button" onClick={onShare}>
                Share image
              </button>
            )}
            <Dialog.Close className={control} aria-label="Close image preview">
              Close
            </Dialog.Close>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
            ref={canvasRef}
            data-image-viewer-canvas=""
            onDoubleClick={() => {
              setView((current) =>
                current.scale > 1
                  ? { scale: 1, x: 0, y: 0 }
                  : bounded({ ...current, scale: 2 }),
              );
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              previous.current = geometry();
            }}
            onPointerMove={(event) => {
              if (!points.current.has(event.pointerId)) return;
              points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const next = geometry(),
                last = previous.current;
              if (next && last)
                setView((v) => {
                  const scale = Math.min(
                    5,
                    Math.max(
                      1,
                      last.distance > 0 && next.distance > 0
                        ? (v.scale * next.distance) / last.distance
                        : v.scale,
                    ),
                  );
                  return bounded({ scale, x: v.x + next.x - last.x, y: v.y + next.y - last.y });
                });
              previous.current = next;
            }}
            onPointerUp={(event) => {
              points.current.delete(event.pointerId);
              previous.current = geometry();
            }}
            onLostPointerCapture={(event) => {
              points.current.delete(event.pointerId);
              previous.current = geometry();
            }}
            onPointerCancel={() => {
              points.current.clear();
              previous.current = null;
            }}
          >
            <img
              ref={imageRef}
              src={src}
              alt={alt}
              draggable={false}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full select-none object-contain"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            />
          </div>
          {onPrepareEdit && (
            <form
              className="shrink-0 space-y-2 px-3 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && instructions.trim()) onPrepareEdit(instructions);
              }}
            >
              <label className="block text-sm" htmlFor="image-edit-instructions">
                Image editing instructions
              </label>
              <div className="flex items-end gap-2">
                <textarea
                  id="image-edit-instructions"
                  aria-label="Image editing instructions"
                  rows={2}
                  maxLength={4000}
                  value={instructions}
                  onChange={(event) => onInstructionsChange(event.target.value)}
                  disabled={busy}
                  className="min-h-12 max-h-28 min-w-0 flex-1 resize-none rounded-2xl border border-white/30 bg-white/10 p-3 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
                  placeholder="Describe the changes…"
                />
                <button className={control} type="submit" disabled={busy || !instructions.trim()}>
                  {busy ? "Preparing…" : "Use in chat"}
                </button>
              </div>
              <p className="text-xs text-white/70">
                Adds this image and your instructions to the draft for review.
              </p>
            </form>
          )}
          <div className="flex shrink-0 items-center justify-center gap-3 p-2">
            <button
              className={control}
              type="button"
              aria-label="Zoom out"
              disabled={view.scale <= 1}
              onClick={() => zoom(-0.5)}
            >
              −
            </button>
            <button
              className={control}
              type="button"
              aria-label="Reset image zoom"
              onClick={() => setView({ scale: 1, x: 0, y: 0 })}
            >
              {Math.round(view.scale * 100)}%
            </button>
            <button
              className={control}
              type="button"
              aria-label="Zoom in"
              disabled={view.scale >= 5}
              onClick={() => zoom(0.5)}
            >
              +
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
