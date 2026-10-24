import { FileText, Loader2 } from "lucide-react";
import type { Attachment } from "@/lib/chat-store";
import { useHistoricalLibraryAvailability } from "@/hooks/use-historical-library-availability";

export function HistoricalLibraryAttachment({
  attachment,
  ownerId,
}: {
  attachment: Extract<Attachment, { kind: "library_file" }>;
  ownerId: string | null;
}) {
  const { elementRef, status, retry } = useHistoricalLibraryAvailability(
    ownerId,
    attachment.libraryItemId,
  );
  const label =
    status === "loading"
      ? "Loading…"
      : status === "unavailable"
        ? "File unavailable"
        : status === "unknown"
          ? "Availability unknown"
          : "Library";
  return (
    <span
      ref={elementRef}
      className="inline-flex min-h-10 max-w-full flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/55 px-3 py-2 text-xs text-foreground"
      title={attachment.name}
      data-library-availability={status}
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="max-w-48 truncate">{attachment.name}</span>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
        {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {label}
      </span>
      {ownerId && (status === "unknown" || status === "unavailable") && (
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={retry}
          aria-label={`Check availability of ${attachment.name}`}
        >
          Check again
        </button>
      )}
    </span>
  );
}
