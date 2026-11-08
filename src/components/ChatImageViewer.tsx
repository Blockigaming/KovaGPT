import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/** A touch-first viewer; all image operations remain explicit user actions. */
export default function ChatImageViewer({
  src,
  alt,
  onClose,
  onDownload,
  onReturnFocus,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onDownload: () => void;
  onReturnFocus: () => void;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const reset = () => setView({ scale: 1, x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
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
      return scale === 1 ? { scale, x: 0, y: 0 } : { ...v, scale };
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
          className="fixed inset-0 z-[120] flex h-[100dvh] min-w-0 flex-col bg-black text-white outline-none"
          style={{
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
            <Dialog.Close className={control} aria-label="Close image preview">
              Close
            </Dialog.Close>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
            data-image-viewer-canvas=""
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              previous.current = geometry();
            }}
            onPointerMove={(event) => {
              if (!points.current.has(event.pointerId)) return;
              points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const bounds = event.currentTarget.getBoundingClientRect();
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
                  if (scale === 1) return { scale, x: 0, y: 0 };
                  return {
                    scale,
                    x: Math.max(
                      (-bounds.width * (scale - 1)) / 2,
                      Math.min((bounds.width * (scale - 1)) / 2, v.x + next.x - last.x),
                    ),
                    y: Math.max(
                      (-bounds.height * (scale - 1)) / 2,
                      Math.min((bounds.height * (scale - 1)) / 2, v.y + next.y - last.y),
                    ),
                  };
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
              src={src}
              alt={alt}
              draggable={false}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full select-none object-contain"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            />
          </div>
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
