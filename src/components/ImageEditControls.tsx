import { useEffect, useState } from "react";
import { imageApiRequest } from "@/lib/image-api-client";
type ImageChoice = { id: string; title: string; file_type: string };
export type ImageEditSelection = { source: ImageChoice; mask?: ImageChoice } | null;
export default function ImageEditControls({
  ownerId,
  disabled,
  value,
  onChange,
}: {
  ownerId: string;
  disabled: boolean;
  value: ImageEditSelection;
  onChange: (value: ImageEditSelection) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [choosing, setChoosing] = useState(false);
  const [images, setImages] = useState<ImageChoice[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [pageCursor, setPageCursor] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void imageApiRequest(
      ownerId,
      `/api/generate-image${choosing ? `?sources=1${pageCursor}` : ""}`,
      controller.signal,
    )
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok)
          throw new Error(
            typeof body.error === "string" ? body.error : "Image options could not be loaded.",
          );
        setEnabled(body.editingEnabled === true);
        if (choosing) {
          setImages(Array.isArray(body.images) ? (body.images as ImageChoice[]) : []);
          setCursor(typeof body.nextCursor === "string" ? body.nextCursor : null);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Image options could not be loaded.");
      });
    return () => controller.abort();
  }, [ownerId, choosing, pageCursor]);
  return (
    <div className="mt-3 rounded-xl border border-border p-3 text-sm">
      {error && <p role="alert">{error}</p>}
      {enabled === null && !error ? (
        <p>Checking image-edit availability…</p>
      ) : enabled === false ? (
        <p>Image editing is not enabled. You can generate a new image.</p>
      ) : null}
      {enabled && (
        <>
          <button
            type="button"
            disabled={disabled}
            className="underline"
            onClick={() => {
              setChoosing(!choosing);
              if (choosing) onChange(null);
            }}
          >
            {choosing ? "Generate a new image instead" : "Edit an image from Library"}
          </button>
          {choosing && (
            <div className="mt-3 flex flex-col gap-2">
              <p>
                Select an original image and describe the change above. The result is a new image;
                your Library original stays available.
              </p>
              <label>
                Original image{" "}
                <select
                  disabled={disabled}
                  aria-label="Original image"
                  className="ml-2 max-w-full rounded border bg-background p-2"
                  value={value?.source.id ?? ""}
                  onChange={(event) => {
                    const source = images.find((item) => item.id === event.target.value);
                    onChange(source ? { source } : null);
                  }}
                >
                  <option value="">Choose a Library image</option>
                  {value && !images.some((item) => item.id === value.source.id) && (
                    <option value={value.source.id}>{value.source.title}</option>
                  )}
                  {images.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              {value && (
                <label>
                  Optional PNG mask{" "}
                  <select
                    disabled={disabled}
                    aria-label="Optional PNG mask"
                    className="ml-2 max-w-full rounded border bg-background p-2"
                    value={value.mask?.id ?? ""}
                    onChange={(event) =>
                      onChange({
                        source: value.source,
                        mask: images.find(
                          (item) =>
                            item.id === event.target.value && item.file_type === "image/png",
                        ),
                      })
                    }
                  >
                    <option value="">No mask</option>
                    {value.mask && !images.some((item) => item.id === value.mask?.id) && (
                      <option value={value.mask.id}>{value.mask.title}</option>
                    )}
                    {images
                      .filter((item) => item.file_type === "image/png")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                PNG/JPEG/WebP originals up to 8 MB. Masks must be PNG with transparency, up to 4 MB,
                and match the original dimensions. A mask guides edits; it does not guarantee
                pixel-perfect preservation.
              </p>
              <div className="flex gap-3">
                {pageCursor && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPageCursor("")}
                    className="underline"
                  >
                    First page
                  </button>
                )}
                {cursor && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPageCursor(cursor)}
                    className="underline"
                  >
                    Next images
                  </button>
                )}
              </div>
              {!images.length && !error && <p>No matching Library images on this page.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
