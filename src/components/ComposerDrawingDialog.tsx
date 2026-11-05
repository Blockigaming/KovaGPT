import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Pencil, Eraser, Undo2, Redo2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Point = readonly [number, number];
type Stroke = { color: string; width: number; points: Point[] };
const BACKGROUND = "#202020";
const COLORS = [
  "#ffffff",
  "#111111",
  "#6b7280",
  "#92400e",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
];
const MAX_STROKES = 300;

/** A local sketch uses the same validated image attachment path as a selected file. */
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
  const active = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const redo = useRef<Stroke[]>([]);
  const filenameRef = useRef("Drawing.png");
  const attaching = useRef(false);
  const mounted = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const [revision, setRevision] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [ink, setInk] = useState("#ffffff");
  const [width, setWidth] = useState(5);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const repaint = useCallback((canvas = canvasRef.current) => {
    const context = canvas?.getContext("2d");
    if (!context || !canvas) return;
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const stroke of strokes.current) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.beginPath();
      const [x, y] = stroke.points[0];
      context.moveTo(x, y);
      context.lineTo(x + 0.01, y + 0.01);
      for (const point of stroke.points.slice(1)) context.lineTo(...point);
      context.stroke();
    }
  }, []);
  const assignCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas && canvasRef.current !== canvas) {
        strokes.current = [];
        redo.current = [];
        active.current = null;
        filenameRef.current = `Drawing-${crypto.randomUUID().slice(0, 8)}.png`;
        repaint(canvas);
        setRevision(0);
        setAttachmentError(null);
        setDiscardOpen(false);
      }
      canvasRef.current = canvas;
    },
    [repaint],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget,
      bounds = canvas.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(canvas.width, ((event.clientX - bounds.left) * canvas.width) / bounds.width),
      ),
      Math.max(
        0,
        Math.min(canvas.height, ((event.clientY - bounds.top) * canvas.height) / bounds.height),
      ),
    ];
  };
  const requestClose = (next: boolean) => {
    if (attaching.current) return;
    active.current = null;
    if (!next && strokes.current.length > 0) setDiscardOpen(true);
    else onOpenChange(next);
  };
  const attach = async () => {
    const canvas = canvasRef.current;
    if (!canvas || attaching.current || strokes.current.length === 0) return;
    attaching.current = true;
    active.current = null;
    setBusy(true);
    setAttachmentError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Drawing could not be prepared.")),
          "image/png",
        ),
      );
      if (canvasRef.current !== canvas || !openRef.current) return;
      const accepted = await onAttach([
        new File([blob], filenameRef.current, { type: "image/png" }),
      ]);
      if (!mounted.current || !openRef.current || canvasRef.current !== canvas) return;
      if (accepted) onOpenChange(false);
      else
        setAttachmentError(
          "Drawing was not attached. Your sketch is still here. Check the attachment limit, then try again.",
        );
    } catch (error) {
      if (mounted.current && openRef.current && canvasRef.current === canvas)
        setAttachmentError(
          error instanceof Error ? error.message : "Drawing could not be attached. Try again.",
        );
    } finally {
      if (canvasRef.current === canvas) {
        attaching.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const history = (direction: "undo" | "redo") => {
    if (attaching.current) return;
    active.current = null;
    const source = direction === "undo" ? strokes.current : redo.current;
    const destination = direction === "undo" ? redo.current : strokes.current;
    const stroke = source.pop();
    if (stroke) destination.push(stroke);
    repaint();
    setRevision((value) => value + 1);
  };
  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          className="kova-drawing-dialog sm:max-w-2xl"
          data-ui-reference="chatgpt.attachment-drawing.dialogcontent"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Drawing</DialogTitle>
            <DialogDescription>
              Draw with your mouse, pen, or finger. Attach it as an image when you're ready.
            </DialogDescription>
          </DialogHeader>
          <div className="kova-drawing-toolbar" role="toolbar" aria-label="Drawing tools">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Pen"
              aria-pressed={tool === "pen"}
              onClick={() => setTool("pen")}
              disabled={busy}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Eraser"
              aria-pressed={tool === "eraser"}
              onClick={() => setTool("eraser")}
              disabled={busy}
            >
              <Eraser aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Undo"
              onClick={() => history("undo")}
              disabled={busy || strokes.current.length === 0}
            >
              <Undo2 aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Redo"
              onClick={() => history("redo")}
              disabled={busy || redo.current.length === 0}
            >
              <Redo2 aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Clear drawing"
              disabled={busy || strokes.current.length === 0}
              onClick={() => {
                active.current = null;
                strokes.current = [];
                redo.current = [];
                repaint();
                setRevision((value) => value + 1);
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
            <label className="kova-drawing-size">
              Size{" "}
              <input
                type="range"
                aria-label="Brush size"
                min="2"
                max="32"
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
                disabled={busy}
              />
            </label>
          </div>
          <canvas
            ref={assignCanvas}
            width={960}
            height={640}
            aria-label="Drawing canvas"
            className="kova-drawing-canvas"
            data-revision={revision}
            onPointerDown={(event) => {
              if (
                attaching.current ||
                active.current ||
                event.button !== 0 ||
                strokes.current.length >= MAX_STROKES
              )
                return;
              event.preventDefault();
              const stroke: Stroke = {
                color: tool === "eraser" ? BACKGROUND : ink,
                width: tool === "eraser" ? width * 3 : width,
                points: [point(event)],
              };
              active.current = { pointerId: event.pointerId, stroke };
              strokes.current.push(stroke);
              redo.current = [];
              event.currentTarget.setPointerCapture(event.pointerId);
              repaint();
              setRevision((value) => value + 1);
            }}
            onPointerMove={(event) => {
              const current = active.current;
              if (
                !current ||
                current.pointerId !== event.pointerId ||
                attaching.current ||
                current.stroke.points.length >= 10000
              )
                return;
              event.preventDefault();
              const context = event.currentTarget.getContext("2d");
              const previous = current.stroke.points.at(-1)!;
              const next = point(event);
              current.stroke.points.push(next);
              if (context) {
                context.strokeStyle = current.stroke.color;
                context.lineWidth = current.stroke.width;
                context.beginPath();
                context.moveTo(...previous);
                context.lineTo(...next);
                context.stroke();
              }
            }}
            onPointerUp={(event) => {
              if (active.current?.pointerId === event.pointerId) {
                active.current = null;
                repaint();
              }
            }}
            onPointerCancel={() => {
              active.current = null;
            }}
            onLostPointerCapture={() => {
              active.current = null;
            }}
          />
          <div className="kova-drawing-colors" role="group" aria-label="Drawing colors">
            <input
              type="color"
              aria-label="Drawing color"
              value={ink}
              onChange={(event) => {
                setInk(event.target.value);
                setTool("pen");
              }}
              disabled={busy}
            />
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Ink ${color}`}
                aria-pressed={ink === color}
                disabled={busy}
                style={{ "--ink-color": color } as React.CSSProperties}
                onClick={() => {
                  setInk(color);
                  setTool("pen");
                }}
              />
            ))}
          </div>
          {strokes.current.length >= MAX_STROKES ? (
            <p role="status" className="text-sm">
              This drawing is full. Undo a stroke or attach it to continue.
            </p>
          ) : null}
          {attachmentError ? (
            <p role="alert" className="text-sm text-destructive">
              {attachmentError}
            </p>
          ) : null}
          <div className="kova-drawing-actions">
            <Button
              variant="ghost"
              type="button"
              onClick={() => requestClose(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="kova-drawing-attach"
              onClick={() => void attach()}
              disabled={busy || strokes.current.length === 0}
            >
              {busy ? "Attaching…" : "Attach drawing"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={open && discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (!openRef.current) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>Your drawing won't be saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                setDiscardOpen(false);
                onOpenChange(false);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
