import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordSpriteVideo, spriteVideoFormat } from "@/lib/response-sprite-video";
import { readChatImage } from "@/lib/chat-image-actions";
import { downloadBytes, safeDocumentFilename } from "@/lib/writing-export/common";

type ExportKind = "gif" | "zip" | "video";

export function ResponseSpriteExport({ src, title }: { src: string; title: string }) {
  const id = useId();
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(2);
  const [delay, setDelay] = useState(160);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [preview, setPreview] = useState<{ url: string; extension: string }>();
  const [videoFormat, setVideoFormat] = useState<ReturnType<typeof spriteVideoFormat>>();
  useEffect(() => setVideoFormat(spriteVideoFormat()), []);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const valid =
    [columns, rows, delay].every(Number.isInteger) &&
    columns >= 1 &&
    columns <= 8 &&
    rows >= 1 &&
    rows <= 8 &&
    columns * rows <= 32 &&
    delay >= 40 &&
    delay <= 2000 &&
    delay % 10 === 0;
  async function exportSprite(kind: ExportKind) {
    if (!valid || request.current || (kind !== "zip" && columns * rows < 2)) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(kind);
    let sourceUrl = "";
    try {
      const [{ spriteFrames, createGifWriter }, blob] = await Promise.all([
        import("@/lib/response-sprite"),
        readChatImage(src, () => !controller.signal.aborted),
      ]);
      if (controller.signal.aborted) return;
      sourceUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      const frames = spriteFrames(image.naturalWidth, image.naturalHeight, { columns, rows });
      const maxWidth = Math.max(...frames.map((frame) => frame.width));
      const maxHeight = Math.max(...frames.map((frame) => frame.height));
      const scale = Math.min(1, (kind === "gif" ? 256 : 512) / Math.max(maxWidth, maxHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(maxWidth * scale));
      canvas.height = Math.max(1, Math.round(maxHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: kind === "gif" });
      if (!context) throw new Error("This browser could not prepare the image.");
      const draw = (index: number) => {
        const frame = frames[index];
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      };
      if (kind === "video") {
        if (!videoFormat) throw new Error("Video export is unavailable in this browser.");
        const video = await recordSpriteVideo(
          canvas,
          draw,
          frames.length,
          delay,
          videoFormat.mime,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setPreview({ url: URL.createObjectURL(video), extension: videoFormat.extension });
        return;
      }
      const writer = kind === "gif" ? createGifWriter(canvas.width, canvas.height, delay) : null;
      const stickers: Record<string, Uint8Array> = {};
      for (const [index] of frames.entries()) {
        if (controller.signal.aborted) return;
        draw(index);
        if (writer) writer.write(context.getImageData(0, 0, canvas.width, canvas.height).data);
        else {
          const sticker = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (result) =>
                result ? resolve(result) : reject(new Error("Could not encode a PNG sticker.")),
              "image/png",
            );
          });
          stickers[`sticker-${String(index + 1).padStart(2, "0")}.png`] = new Uint8Array(
            await sticker.arrayBuffer(),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (controller.signal.aborted) return;
      if (writer) {
        const bytes = writer.finish();
        setPreview({
          url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/gif" })),
          extension: "gif",
        });
      } else {
        const { zipSync } = await import("fflate");
        if (controller.signal.aborted) return;
        downloadBytes(zipSync(stickers), "application/zip", safeDocumentFilename(title, "zip"));
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not export this image.");
    } finally {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return (
    <section className="grid gap-3 text-sm" aria-labelledby={id}>
      <h3 id={id} className="font-medium">
        Sprite sheet exports
      </h3>
      <p className="text-muted-foreground">
        Use an evenly spaced grid. Frames are read left to right, then top to bottom.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Columns", columns, setColumns, 1, 8, 1],
            ["Rows", rows, setRows, 1, 8, 1],
            ["Delay (ms)", delay, setDelay, 40, 2000, 10],
          ] as const
        ).map(([label, value, setValue, min, max, step]) => (
          <label key={label} className="grid min-w-0 gap-1">
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={Number.isNaN(value) ? "" : value}
              disabled={!!busy}
              className="min-h-11 min-w-0 rounded-lg border border-border bg-background px-2"
              onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
            />
          </label>
        ))}
      </div>
      {!valid && (
        <p role="status">Use up to 32 frames and a delay from 40 to 2,000 ms in 10 ms steps.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!!busy || !valid || columns * rows < 2}
          onClick={() => void exportSprite("gif")}
        >
          {busy === "gif" ? "Creating GIF…" : "Create GIF"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy || !valid}
          onClick={() => void exportSprite("zip")}
        >
          {busy === "zip" ? "Preparing stickers…" : "Download sticker ZIP"}
        </Button>
        {videoFormat && (
          <Button
            type="button"
            variant="outline"
            disabled={!!busy || !valid || columns * rows < 2}
            onClick={() => void exportSprite("video")}
          >
            {busy === "video" ? "Creating video…" : "Create video"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <div className="grid justify-items-start gap-2">
          {preview.extension === "gif" ? (
            <img
              src={preview.url}
              alt={`Animated preview of ${title}`}
              className="max-h-64 max-w-full object-contain"
            />
          ) : (
            <video
              controls
              playsInline
              src={preview.url}
              aria-label={`Video preview of ${title}`}
              className="max-h-64 max-w-full object-contain"
            />
          )}
          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex min-h-11 items-center underline"
              href={preview.url}
              download={safeDocumentFilename(title, preview.extension)}
            >
              {preview.extension === "gif" ? "Download GIF" : "Download video"}
            </a>
            <Button type="button" variant="ghost" onClick={() => setPreview(undefined)}>
              Close preview
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
