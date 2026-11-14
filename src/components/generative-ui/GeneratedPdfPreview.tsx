import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LibraryPdfPreview } from "@/lib/library-document-preview";

export function GeneratedPdfPreview({ title, content }: { title: string; content: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<LibraryPdfPreview>();
  const [page, setPage] = useState(1);
  const [paintedPage, setPaintedPage] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const scope = new AbortController();
    let active: LibraryPdfPreview | undefined;
    async function open() {
      try {
        const [{ createDocumentFile }, { loadPdfPreview }] = await Promise.all([
          import("@/lib/writing-export/export"),
          import("@/lib/library-document-preview"),
        ]);
        if (scope.signal.aborted) return;
        active = await loadPdfPreview(async () => {
          const { bytes, type } = await createDocumentFile("pdf", title, content);
          return new Blob([bytes as BlobPart], { type });
        }, scope.signal);
        if (!scope.signal.aborted) setSession(active);
      } catch (cause) {
        if (!scope.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not preview the PDF.");
      }
    }
    void open();
    return () => {
      scope.abort();
      active?.destroy();
    };
  }, [title, content]);

  useEffect(() => {
    const target = canvas.current;
    if (!session || !target) return;
    const scope = new AbortController();
    void session
      .renderPage(page, target, scope.signal)
      .then(() => {
        if (!scope.signal.aborted) setPaintedPage(page);
      })
      .catch(() => {
        if (!scope.signal.aborted) setError("Could not draw this PDF page.");
      });
    return () => {
      scope.abort();
      target.width = target.height = 0;
    };
  }, [session, page]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!session)
    return (
      <p role="status" className="text-sm">
        Preparing PDF preview…
      </p>
    );
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={page === 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Previous page
        </Button>
        <span role="status" className="text-sm tabular-nums">
          {paintedPage === page ? `Page ${page} of ${session.pageCount}` : `Drawing page ${page}…`}
        </span>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={page === session.pageCount}
          onClick={() => setPage((value) => Math.min(session.pageCount, value + 1))}
        >
          Next page
        </Button>
      </div>
      <canvas
        ref={canvas}
        aria-label={`${title}, page ${page}`}
        role="img"
        aria-busy={paintedPage !== page}
        className="mx-auto block h-auto max-w-full border border-border bg-white"
      />
    </div>
  );
}
