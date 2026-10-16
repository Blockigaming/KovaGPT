import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { inspectImageBytes } from "@/lib/multimodal/image-bytes.mjs";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { adjustImagePixels, DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/local-image-adjustments.mjs";
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image encoding failed"));
    reader.onerror = () => reject(new Error("Image encoding failed"));
    reader.readAsDataURL(blob);
  });
}
export function LocalImageEditor({
  source,
  actor,
  onDirtyChange,
}: {
  source: { id: string; imageUrl: string; prompt: string };
  actor: string | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [original, setOriginal] = useState<{ blob: Blob; url: string; pixels: ImageData } | null>(
      null,
    ),
    [current, setCurrent] = useState<{ blob: Blob; url: string } | null>(null),
    [settings, setSettings] = useState(DEFAULT_IMAGE_ADJUSTMENTS),
    [compare, setCompare] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<{ blob: Blob; id: string } | null>(null);
  const active = useRef(true),
    revision = useRef(0),
    pending = useRef(false),
    attempt = useRef<{ digest: string; id: string } | null>(null),
    save = useServerFn(saveImageToLibrary);
  const adjusted = JSON.stringify(settings) !== JSON.stringify(DEFAULT_IMAGE_ADJUSTMENTS);
  useBlocker({
    shouldBlockFn: () =>
      (adjusted || saving) &&
      !window.confirm(
        "Leave local image edits? Download current edits first; submitted saves may still complete.",
      ),
    enableBeforeUnload: adjusted || saving,
  });
  useEffect(() => {
    onDirtyChange(adjusted || saving);
    return () => onDirtyChange(false);
  }, [adjusted, saving, onDirtyChange]);
  useEffect(() => {
    const sourceRevision = revision;
    active.current = true;
    const controller = new AbortController();
    let originalUrl: string | undefined;
    void (async () => {
      const url = new URL(source.imageUrl, window.location.href);
      const response =
        url.origin === window.location.origin && url.pathname.startsWith("/api/")
          ? await fetchWithTimeoutAuthenticated(url, { signal: controller.signal }, 15000)
          : await fetch(url, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
              credentials: "omit",
              redirect: "error",
            });
      if (!response.ok)
        throw new Error("The original image could not be loaded. Its URL may have expired.");
      const bytes = await readResponseBytesBounded(response, 8 * 1024 * 1024, {
        signal: controller.signal,
        timeoutMs: 15000,
      });
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const dimensions = inspectImageBytes(bytes, type);
      if (dimensions.width * dimensions.height > 16000000)
        throw new Error("Local editing supports images up to 16 megapixels.");
      const blob = new Blob([new Uint8Array(bytes)], { type });
      const bitmap = await createImageBitmap(blob);
      try {
        if (!active.current || controller.signal.aborted) return;
        if (bitmap.width * bitmap.height > 16000000)
          throw new Error("Decoded image exceeds the local editor limit.");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Local pixel editing is unavailable.");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        originalUrl = URL.createObjectURL(blob);
        setOriginal({ blob, url: originalUrl, pixels });
      } finally {
        bitmap.close();
      }
    })().catch((e) => {
      if (active.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Image could not be opened");
    });
    return () => {
      active.current = false;
      sourceRevision.current++;
      controller.abort();
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [source.imageUrl]);
  useEffect(() => {
    if (!original) return;
    const renderRevision = revision;
    const version = ++renderRevision.current;
    setCurrent(null);
    let url: string | undefined;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = original.pixels.width;
      canvas.height = original.pixels.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Local pixel editing is unavailable.");
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(adjustImagePixels(original.pixels.data, settings)),
          canvas.width,
          canvas.height,
        ),
        0,
        0,
      );
      canvas.toBlob((blob) => {
        if (!active.current || version !== revision.current) return;
        if (!blob || blob.size > 8 * 1024 * 1024) {
          setError("Edited PNG exceeds the 8 MB saving limit or could not be encoded.");
          return;
        }
        url = URL.createObjectURL(blob);
        setCurrent({ blob, url });
      }, "image/png");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Local editing failed");
    }
    return () => {
      renderRevision.current++;
      if (url) URL.revokeObjectURL(url);
    };
  }, [original, settings]);
  const saveCopy = async () => {
    if (!actor || !current || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    const blob = current.blob;
    try {
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (!active.current) return;
      if (attempt.current?.digest !== digest) attempt.current = { digest, id: crypto.randomUUID() };
      const imageUrl = await dataUrl(blob);
      if (!active.current) return;
      const row = await save({
        data: {
          expectedOwnerId: actor,
          idempotencyKey: attempt.current.id,
          title: `${source.prompt.slice(0, 100) || "Image"} — edited copy`,
          prompt: source.prompt.slice(0, 2000),
          imageUrl,
        },
      });
      if (active.current) setSaved({ blob, id: row.id });
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Save failed. Retry the same edits to reuse the save identity.",
        );
    } finally {
      if (active.current) {
        pending.current = false;
        setSaving(false);
      }
    }
  };
  return (
    <section
      className="w-full space-y-3 rounded-2xl bg-background p-4 text-foreground"
      aria-label="Local image adjustments"
    >
      {(compare ? original?.url : current?.url) ? (
        <img
          src={compare ? original?.url : current?.url}
          alt={compare ? "Original image" : "Current local edits"}
          className="mx-auto max-h-[55dvh] max-w-full object-contain"
        />
      ) : (
        <>
          <img
            src={source.imageUrl}
            alt="Original image"
            className="mx-auto max-h-[55dvh] max-w-full object-contain"
          />
          <p role="status">
            {error
              ? "Image editor unavailable; original preview retained."
              : "Preparing original pixels…"}
          </p>
        </>
      )}
      {original && (
        <p className="text-sm">
          {original.pixels.width} × {original.pixels.height} pixels · Local adjustments only.
          Original bytes remain unchanged; edited copies are static PNGs without original metadata.
        </p>
      )}
      {(["brightness", "contrast", "saturation"] as const).map((name) => (
        <label key={name} className="flex min-h-11 flex-wrap items-center gap-3 capitalize">
          {name}
          <input
            className="kova-image-adjustment-range min-w-0 flex-1"
            type="range"
            min={name === "saturation" ? 0 : -100}
            max={name === "saturation" ? 200 : 100}
            value={settings[name]}
            disabled={!original}
            onChange={(e) => {
              setError("");
              setSettings({ ...settings, [name]: Number(e.target.value) });
            }}
          />
          <output>{settings[name]}</output>
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-xl border px-3"
          aria-pressed={compare}
          onClick={() => setCompare(!compare)}
        >
          Compare original
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl border px-3"
          onClick={() => {
            setSettings(DEFAULT_IMAGE_ADJUSTMENTS);
            setCompare(false);
            setError("");
          }}
        >
          Reset adjustments
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl border px-3"
          disabled={!current}
          onClick={() => current && download(current.blob, `kova-${source.id}-current.png`)}
        >
          Download current edits
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl border px-3"
          disabled={!original}
          onClick={() =>
            original &&
            download(
              original.blob,
              `kova-${source.id}-original.${original.blob.type === "image/jpeg" ? "jpg" : original.blob.type.split("/")[1]}`,
            )
          }
        >
          Download original bytes
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl border px-3"
          disabled={!current || !actor || saving || !adjusted}
          onClick={() => void saveCopy()}
        >
          {saving ? "Saving edited copy…" : "Save edited copy"}
        </button>
        {saved && (
          <button
            type="button"
            className="min-h-11 rounded-xl border px-3"
            onClick={() => download(saved.blob, `kova-${saved.id}-saved.png`)}
          >
            Download saved edited copy
          </button>
        )}
      </div>
      {saved && (
        <p role="status">
          Edited copy saved to Library. Download saved copy uses those acknowledged bytes; newer
          adjustments remain separate.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
