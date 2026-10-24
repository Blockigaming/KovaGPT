import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";
import type { LibraryItem } from "@/lib/library.functions";
import {
  createLibraryDocumentViewMemory,
  documentPreviewAvailability,
  LIBRARY_PDF_ZOOM_LEVELS,
  loadLibraryPdfPreview,
  previewFailureMessage,
  type LibraryPdfPreview,
  type LibraryDocumentView,
  type LibraryDocumentViewMemory,
} from "@/lib/library-document-preview";

type Props = {
  item: LibraryItem;
  ownerId: string | null;
  viewMemory?: LibraryDocumentViewMemory;
};
type PreviewState = {
  scope: string;
  status: "idle" | "loading" | "ready" | "error";
  session?: LibraryPdfPreview;
  error?: string;
};

export function LibraryDocumentPreview({ item, ownerId, viewMemory }: Props) {
  const scope = JSON.stringify([ownerId, item.id, item.original_generation]);
  const localMemory = useMemo(() => createLibraryDocumentViewMemory(ownerId), [ownerId]);
  const memory = viewMemory ?? localMemory;
  const identity = useMemo(
    () => ({ ownerId, id: item.id, generation: item.original_generation }),
    [ownerId, item.id, item.original_generation],
  );
  const restoredView = useMemo(() => memory.read(identity), [memory, identity]);
  const [view, setView] = useState({ scope, memory, ...restoredView });
  const currentView = view.scope === scope && view.memory === memory ? view : restoredView;
  const { page, zoom } = currentView;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [request, setRequest] = useState<{ scope: string; attempt: number } | null>(null);
  const [state, setState] = useState<PreviewState>({ scope, status: "idle" });
  const [renderedView, setRenderedView] = useState<LibraryDocumentView | null>(null);
  const visible = state.scope === scope ? state : { scope, status: "idle" as const };
  const availability = documentPreviewAvailability(item, ownerId);
  const requested = request?.scope === scope;

  useEffect(() => {
    setRenderedView(null);
    if (!requested || !availability.available || !ownerId || !item.original_generation) {
      setRequest(null);
      setState({ scope, status: "idle" });
      return;
    }
    const controller = new AbortController();
    let session: LibraryPdfPreview | undefined;
    setState({ scope, status: "loading" });
    void loadLibraryPdfPreview({
      ownerId,
      id: item.id,
      generation: item.original_generation,
      signal: controller.signal,
    })
      .then((loaded) => {
        if (controller.signal.aborted || currentScope.current !== scope) {
          loaded.destroy();
          return;
        }
        session = loaded;
        const saved = memory.read(identity);
        const next = { page: Math.min(saved.page, loaded.pageCount), zoom: saved.zoom };
        // Clamp only to the current original's confirmed page count.
        memory.remember(identity, next);
        setView({ scope, memory, ...next });
        setState({ scope, status: "ready", session });
      })
      .catch((error) => {
        if (!controller.signal.aborted && currentScope.current === scope)
          setState({ scope, status: "error", error: previewFailureMessage(error) });
      });
    return () => {
      controller.abort();
      session?.destroy();
    };
  }, [
    scope,
    requested,
    request?.attempt,
    availability.available,
    ownerId,
    item.id,
    item.original_generation,
    memory,
    identity,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const session = visible.session;
    if (visible.status !== "ready" || !session || !canvas) return;
    const controller = new AbortController();
    setRenderedView(null);
    void session
      .renderPage(page, canvas, controller.signal, zoom)
      .then(() => {
        if (!controller.signal.aborted && currentScope.current === scope)
          setRenderedView({ page, zoom });
      })
      .catch((error) => {
        if (controller.signal.aborted || currentScope.current !== scope) return;
        session.destroy();
        canvas.width = canvas.height = 0;
        setState({ scope, status: "error", error: previewFailureMessage(error) });
      });
    return () => {
      controller.abort();
      canvas.width = canvas.height = 0;
    };
  }, [scope, visible.status, visible.session, page, zoom]);

  const ready = visible.status === "ready";
  const drawing = ready && (renderedView?.page !== page || renderedView?.zoom !== zoom);
  const zoomIndex = LIBRARY_PDF_ZOOM_LEVELS.indexOf(zoom);
  const load = () => setRequest({ scope, attempt: (request?.attempt ?? 0) + 1 });
  const changeView = (next: LibraryDocumentView) => {
    // Focus only for explicit navigation, never for asynchronous completion.
    // This status remains usable when the clicked paging button is disabled.
    statusRef.current?.focus({ preventScroll: true });
    memory.remember(identity, next);
    setView({ scope, memory, ...next });
  };
  return (
    <section aria-label="Original document preview" className="space-y-3 text-sm">
      <p className="text-muted-foreground">{availability.message}</p>
      {availability.available ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11"
              onClick={
                visible.status === "idle" || visible.status === "error"
                  ? load
                  : () => setRequest(null)
              }
            >
              {visible.status === "idle"
                ? "Load PDF preview"
                : visible.status === "error"
                  ? "Retry PDF preview"
                  : visible.status === "loading"
                    ? "Cancel preview"
                    : "Close PDF preview"}
            </Button>
            {ready ? (
              <div
                role="group"
                aria-label="PDF page navigation"
                className="spec400-pdf-pagination flex w-full min-w-0 items-center gap-2 sm:w-auto"
              >
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  disabled={page <= 1 || drawing}
                  onClick={() => changeView({ page: page - 1, zoom })}
                  aria-label="Previous PDF page"
                >
                  Previous
                </Button>
                <span className="min-w-0 flex-1 text-center">
                  Page {page} of {visible.session?.pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  disabled={page >= (visible.session?.pageCount ?? 1) || drawing}
                  onClick={() => changeView({ page: page + 1, zoom })}
                  aria-label="Next PDF page"
                >
                  Next
                </Button>
              </div>
            ) : null}
            {ready ? (
              <div
                role="group"
                aria-label="PDF zoom"
                className="spec400-pdf-pagination flex w-full min-w-0 items-center gap-2 sm:w-auto"
              >
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  aria-label="Zoom out PDF"
                  disabled={zoomIndex <= 0 || drawing}
                  onClick={() => changeView({ page, zoom: LIBRARY_PDF_ZOOM_LEVELS[zoomIndex - 1] })}
                >
                  Zoom out
                </Button>
                <span className="min-w-0 flex-1 text-center" aria-label="Current PDF zoom">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  aria-label="Zoom in PDF"
                  disabled={zoomIndex >= LIBRARY_PDF_ZOOM_LEVELS.length - 1 || drawing}
                  onClick={() => changeView({ page, zoom: LIBRARY_PDF_ZOOM_LEVELS[zoomIndex + 1] })}
                >
                  Zoom in
                </Button>
              </div>
            ) : null}
          </div>
          <p
            ref={statusRef}
            tabIndex={-1}
            className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role={visible.status === "error" ? "alert" : "status"}
            aria-live="polite"
            aria-atomic="true"
          >
            {visible.status === "loading" || drawing ? (
              <LoaderCircle
                aria-hidden="true"
                size={16}
                className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {visible.status === "loading"
              ? "Loading original PDF…"
              : visible.status === "error"
                ? `Preview unavailable. ${visible.error}`
                : ready
                  ? drawing
                    ? `Rendering page ${page}…`
                    : `Page ${page} of ${visible.session?.pageCount} displayed. Zoom ${Math.round(zoom * 100)}%.`
                  : "PDF preview has not been loaded."}
          </p>
          {ready ? (
            <figure
              className="rounded-[var(--kova-radius-output)] border border-border bg-muted p-2"
              aria-busy={drawing}
            >
              <div
                className="max-h-[65dvh] max-w-full overflow-auto overscroll-contain"
                role="region"
                aria-label="Scrollable original PDF page"
                tabIndex={0}
              >
                <canvas
                  key={scope}
                  ref={canvasRef}
                  role="img"
                  aria-label={`Original PDF page ${page} of ${visible.session?.pageCount}. Use Extracted text for available readable text.`}
                  className="mx-auto block h-auto max-w-none"
                  style={{ width: `${zoom * 100}%`, visibility: drawing ? "hidden" : "visible" }}
                />
              </div>
              <figcaption className="mt-2 text-xs text-muted-foreground">
                Page image only. Forms, links and annotations are disabled; some fonts or large
                images may be unavailable. Available saved text is in Extracted text. Zoom is
                relative to the viewer width; rendering resolution stays within preview limits.
              </figcaption>
            </figure>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
