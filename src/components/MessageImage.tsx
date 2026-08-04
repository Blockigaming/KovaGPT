import { useState, type ImgHTMLAttributes } from "react";
import { ImageOff, Loader2 } from "lucide-react";

export function MessageImage({
  className = "",
  alt = "",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className="my-3 flex min-h-32 w-full max-w-md items-center justify-center gap-2 rounded-xl border border-border bg-muted text-sm text-muted-foreground"
        role="img"
        aria-label={alt ? `Image unavailable: ${alt}` : "Image unavailable"}
      >
        <ImageOff className="h-5 w-5" /> Image unavailable
      </span>
    );
  }
  return (
    <span className="relative my-3 inline-block max-w-full overflow-hidden rounded-xl">
      {loading ? (
        <span
          className="absolute inset-0 flex min-h-32 items-center justify-center bg-muted"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="sr-only">Loading image</span>
        </span>
      ) : null}
      <img
        {...props}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        className={`block h-auto max-h-[32rem] max-w-full object-contain ${className}`}
      />
    </span>
  );
}
