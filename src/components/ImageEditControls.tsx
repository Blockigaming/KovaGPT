import { useEffect, useState } from "react";
import { ImagePlus, ArrowLeft } from "lucide-react";
import { imageApiRequest } from "@/lib/image-api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const emptyImageChoice = "no-library-image";
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
    <div className="kova-library-image-edit text-sm">
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
            className="inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 underline-offset-4 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onClick={() => {
              setChoosing(!choosing);
              if (choosing) onChange(null);
            }}
          >
            {choosing ? (
              <ArrowLeft className="size-4" aria-hidden="true" />
            ) : (
              <ImagePlus className="size-4" aria-hidden="true" />
            )}
            {choosing ? "Generate a new image instead" : "Edit an image from Library"}
          </button>
          {choosing && (
            <div className="mt-3 flex flex-col gap-2">
              <p>
                Select an original image and describe the change above. The result is a new image;
                your Library original stays available.
              </p>
              <label className="grid min-w-0 gap-2">
                Original image{" "}
                <Select
                  disabled={disabled}
                  value={value?.source.id ?? emptyImageChoice}
                  onValueChange={(id) => {
                    const source = images.find((item) => item.id === id);
                    onChange(source ? { source } : null);
                  }}
                >
                  <SelectTrigger aria-label="Original image" className="min-h-11 w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptyImageChoice}>Choose a Library image</SelectItem>
                    {value && !images.some((item) => item.id === value.source.id) && (
                      <SelectItem value={value.source.id}>{value.source.title}</SelectItem>
                    )}
                    {images.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {value && (
                <label className="grid min-w-0 gap-2">
                  Optional PNG mask{" "}
                  <Select
                    disabled={disabled}
                    value={value.mask?.id ?? emptyImageChoice}
                    onValueChange={(id) =>
                      onChange({
                        source: value.source,
                        mask: images.find(
                          (item) => item.id === id && item.file_type === "image/png",
                        ),
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Optional PNG mask"
                      className="min-h-11 w-full min-w-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={emptyImageChoice}>No mask</SelectItem>
                      {value.mask && !images.some((item) => item.id === value.mask?.id) && (
                        <SelectItem value={value.mask.id}>{value.mask.title}</SelectItem>
                      )}
                      {images
                        .filter((item) => item.file_type === "image/png")
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.title}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                PNG/JPEG/WebP originals up to 8 MB. Masks must be PNG with transparency, up to 4 MB,
                and match the original dimensions. A mask guides edits; it does not guarantee
                pixel-perfect preservation.
              </p>
              <div className="flex flex-wrap gap-2">
                {pageCursor && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPageCursor("")}
                    className="inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 underline-offset-4 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    First page
                  </button>
                )}
                {cursor && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPageCursor(cursor)}
                    className="inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 underline-offset-4 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
