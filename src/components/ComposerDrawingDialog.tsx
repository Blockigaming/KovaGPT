import { useCallback, useRef, useState, type PointerEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

/** A local sketch becomes a normal validated image attachment, never a generated result. */
export function ComposerDrawingDialog({
  open,
  onOpenChange,
  onAttach,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (files: File[]) => Promise<boolean>;
  onReturnFocus: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const filenameRef = useRef("Drawing.png");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [ink, setInk] = useState("#111111");
  const [busy, setBusy] = useState(false);
  const clear = useCallback((canvas = canvasRef.current) => {
    const context = canvas?.getContext("2d");
    if (!context || !canvas) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 4;
    context.lineJoin = "round";
    context.lineCap = "round";
  }, []);
  const assignCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas && canvasRef.current !== canvas) {
        clear(canvas);
        filenameRef.current = `Drawing-${crypto.randomUUID().slice(0, 8)}.png`;
        setAttachmentError(null);
      }
      canvasRef.current = canvas;
    },
    [clear],
  );
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget,
      bounds = canvas.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) * canvas.width) / bounds.width,
      ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    ] as const;
  };
  const attach = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    setAttachmentError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvasRef.current!.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Drawing could not be prepared.")),
          "image/png",
        ),
      );
      const accepted = await onAttach([
        new File([blob], filenameRef.current, { type: "image/png" }),
      ]);
      if (accepted) onOpenChange(false);
      else
        setAttachmentError(
          "Drawing was not attached. Your sketch is still here. Check the attachment limit or error, then try again.",
        );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Drawing could not be attached. Try again.";
      setAttachmentError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="kova-drawing-dialog sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Drawings</DialogTitle>
          <DialogDescription>
            Sketch with a pointer or your finger, then attach the drawing as an image.
          </DialogDescription>
        </DialogHeader>
        <div className="kova-drawing-tools">
          <label>
            Ink{" "}
            <input
              type="color"
              aria-label="Drawing color"
              value={ink}
              onChange={(event) => setInk(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => clear()} disabled={busy}>
            Clear drawing
          </button>
        </div>
        <canvas
          ref={assignCanvas}
          width={960}
          height={640}
          aria-label="Drawing canvas"
          className="kova-drawing-canvas"
          onPointerDown={(event) => {
            if (busy || event.button !== 0) return;
            event.preventDefault();
            const context = event.currentTarget.getContext("2d");
            if (!context) return;
            drawing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            context.strokeStyle = ink;
            context.beginPath();
            const [x, y] = point(event);
            context.moveTo(x, y);
            context.lineTo(x + 0.01, y + 0.01);
            context.stroke();
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            event.preventDefault();
            const context = event.currentTarget.getContext("2d");
            context?.lineTo(...point(event));
            context?.stroke();
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
          onLostPointerCapture={() => {
            drawing.current = false;
          }}
        />
        {attachmentError ? (
          <p role="alert" className="text-sm text-destructive">
            {attachmentError}
          </p>
        ) : null}
        <div className="kova-drawing-actions">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="kova-drawing-attach"
            onClick={() => void attach()}
            disabled={busy}
          >
            {busy ? "Attaching…" : "Attach drawing"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
