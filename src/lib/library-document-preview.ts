import type {
  DocumentInitParameters,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";

export const LIBRARY_PDF_PREVIEW_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  pages: 100,
  dimension: 1600,
  pixels: 1_500_000,
  scratchPixels: 6_000_000,
  loadMs: 25_000,
  pageMs: 12_000,
});

export class LibraryPreviewError extends Error {}

export const LIBRARY_PDF_ZOOM_LEVELS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
export const LIBRARY_PDF_VIEW_MEMORY_LIMIT = 20;
export type LibraryDocumentView = { page: number; zoom: number };
type ViewIdentity = { ownerId: string | null; id: string; generation?: string };
const defaultView = (): LibraryDocumentView => ({ page: 1, zoom: 1 });

/** Route-lifetime, bounded preferences only: never bytes, text, URLs, canvases or workers. */
export function createLibraryDocumentViewMemory(ownerId: string | null) {
  const entries = new Map<string, { generation: string; view: LibraryDocumentView }>();
  const valid = (identity: ViewIdentity) =>
    ownerId !== null &&
    identity.ownerId === ownerId &&
    Boolean(identity.id && identity.id.length <= 256) &&
    Boolean(identity.generation && identity.generation.length <= 256);
  const read = (identity: ViewIdentity): LibraryDocumentView => {
    if (!valid(identity)) return defaultView();
    const saved = entries.get(identity.id);
    const view = saved && saved.generation === identity.generation ? saved.view : defaultView();
    // One generation per item. Access refreshes the bounded least-recently-used order.
    entries.delete(identity.id);
    entries.set(identity.id, { generation: identity.generation!, view });
    while (entries.size > LIBRARY_PDF_VIEW_MEMORY_LIMIT)
      entries.delete(entries.keys().next().value!);
    return { ...view };
  };
  return {
    read,
    remember(identity: ViewIdentity, view: LibraryDocumentView) {
      if (!valid(identity) || entries.get(identity.id)?.generation !== identity.generation) return;
      const safe = {
        page:
          Number.isInteger(view.page) && view.page >= 1
            ? Math.min(view.page, LIBRARY_PDF_PREVIEW_LIMITS.pages)
            : 1,
        zoom: LIBRARY_PDF_ZOOM_LEVELS.includes(view.zoom) ? view.zoom : 1,
      };
      entries.delete(identity.id);
      entries.set(identity.id, { generation: identity.generation!, view: safe });
    },
  };
}
export type LibraryDocumentViewMemory = ReturnType<typeof createLibraryDocumentViewMemory>;

export function documentPreviewAvailability(
  item: { file_name: string | null; file_type: string | null; original_generation?: string },
  ownerId: string | null,
) {
  const extension = item.file_name?.split(".").at(-1)?.toLowerCase();
  const office =
    extension === "docx" || extension === "xlsx" || extension === "pptx"
      ? extension.toUpperCase()
      : item.file_type?.includes("wordprocessingml")
        ? "DOCX"
        : item.file_type?.includes("spreadsheetml")
          ? "XLSX"
          : item.file_type?.includes("presentationml")
            ? "PPTX"
            : null;
  if (office)
    return {
      available: false,
      message: `${office} original preview is unavailable. Use Extracted text to read available text${ownerId && item.original_generation ? ", or Download original from the item menu." : "."}`,
    };
  if (item.file_type !== "application/pdf" && extension !== "pdf")
    return {
      available: false,
      message:
        "Original preview is unavailable for this item. Use Extracted text to read its saved text.",
    };
  if (!ownerId || !item.original_generation)
    return {
      available: false,
      message:
        "A saved original PDF is unavailable for this item. Use Extracted text to read any available text.",
    };
  return {
    available: true,
    message:
      "Load the saved original PDF to view its pages. Preview supports PDFs up to 10 MB and 100 pages.",
  };
}

export function boundedPreviewSize(width: number, height: number, zoom = 1) {
  if (!LIBRARY_PDF_ZOOM_LEVELS.includes(zoom))
    throw new LibraryPreviewError("Choose an available PDF zoom level.");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new LibraryPreviewError("This PDF page has unsupported dimensions.");
  const { dimension, pixels } = LIBRARY_PDF_PREVIEW_LIMITS;
  const scale = Math.min(
    1.5 * zoom,
    dimension / width,
    dimension / height,
    Math.sqrt(pixels / width / height),
  );
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  if (!Number.isFinite(scale) || scale <= 0 || w > dimension || h > dimension || w * h > pixels)
    throw new LibraryPreviewError("This PDF page has unsupported dimensions.");
  return { width: w, height: h, scale };
}

/** PDF.js resource requests are denied, including fonts, CMaps and WASM. */
export class NoPreviewExternalResources {
  async fetch() {
    throw new LibraryPreviewError("This PDF needs an unsupported rendering resource.");
  }
}

/** Only app-bundled font bytes are allowed; filenames never become request URLs. */
export function bundledPreviewFontFactory(
  fonts: Readonly<Record<string, string>>,
  onUnavailableResource?: () => void,
) {
  return class BundledPreviewFontData {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      if (kind !== "standardFontDataUrl" || !Object.hasOwn(fonts, filename)) {
        onUnavailableResource?.();
        throw new LibraryPreviewError("This PDF needs an unsupported rendering resource.");
      }
      const data = fonts[filename];
      const encoded = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/u.exec(data)?.[1];
      if (!encoded || encoded.length > 400_000) {
        onUnavailableResource?.();
        throw new LibraryPreviewError("A bundled preview font is unavailable.");
      }
      return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    }
  };
}

type CanvasPair = { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null };

/** Apply the same bounds to PDF.js scratch surfaces, with a total live allocation cap. */
export class BoundedPreviewCanvasFactory {
  private allocations = new Map<HTMLCanvasElement, number>();
  private ownerDocument: Document;
  constructor({ ownerDocument = document }: { ownerDocument?: Document } = {}) {
    this.ownerDocument = ownerDocument;
  }
  private size(canvas: HTMLCanvasElement, width: number, height: number) {
    const w = Math.ceil(width),
      h = Math.ceil(height);
    const limits = LIBRARY_PDF_PREVIEW_LIMITS;
    const pixels = w * h;
    const current = [...this.allocations.values()].reduce((sum, value) => sum + value, 0);
    if (
      !Number.isFinite(pixels) ||
      w < 1 ||
      h < 1 ||
      w > limits.dimension ||
      h > limits.dimension ||
      pixels > limits.pixels ||
      current - (this.allocations.get(canvas) ?? 0) + pixels > limits.scratchPixels
    )
      throw new LibraryPreviewError("This PDF page exceeds the preview rendering limit.");
    canvas.width = w;
    canvas.height = h;
    this.allocations.set(canvas, pixels);
  }
  create(width: number, height: number): CanvasPair {
    const canvas = this.ownerDocument.createElement("canvas");
    this.size(canvas, width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      this.destroy({ canvas, context: null });
      throw new LibraryPreviewError("PDF preview is unavailable in this browser.");
    }
    return { canvas, context };
  }
  reset(pair: CanvasPair, width: number, height: number) {
    if (!pair.canvas) throw new LibraryPreviewError("PDF preview was closed.");
    this.size(pair.canvas, width, height);
  }
  destroy(pair: CanvasPair) {
    if (pair.canvas) {
      this.allocations.delete(pair.canvas);
      pair.canvas.width = pair.canvas.height = 0;
    }
    pair.canvas = null;
    pair.context = null;
  }
}

export type PreviewRenderer = {
  getDocument: (
    options: DocumentInitParameters,
    onUnavailableResource?: () => void,
  ) => PDFDocumentLoadingTask;
  destroy: () => void;
};
type PreviewDependencies = {
  readOriginal: (
    ownerId: string,
    id: string,
    generation: string,
    signal: AbortSignal,
  ) => Promise<Blob>;
  loadRenderer: () => Promise<PreviewRenderer>;
};
export type LibraryPdfPreview = {
  pageCount: number;
  renderPage: (
    page: number,
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
    zoom?: number,
  ) => Promise<void>;
  destroy: () => void;
};

function boundedOperation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: T | unknown, failed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      timer = undefined;
      signal.removeEventListener("abort", abort);
      if (failed) reject(value);
      else resolve(value as T);
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"), true);
    promise.then(
      (value) => finish(value, false),
      (error) => finish(error, true),
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      finish(
        new LibraryPreviewError("PDF preview took too long. Try again or use Extracted text."),
        true,
      );
      onTimeout();
    }, milliseconds);
  });
}

export function previewFailureMessage(error: unknown) {
  if (error instanceof LibraryPreviewError) return error.message;
  if (error instanceof Error && error.name === "PasswordException")
    return "This PDF is password protected. Preview requires an unlocked copy.";
  return "This PDF could not be previewed safely. Try again or use Extracted text.";
}

/** Byte-only, owner/generation-scoped input. No file URL, annotation or scripting layer. */
export async function loadLibraryPdfPreview(
  scope: { ownerId: string; id: string; generation: string; signal: AbortSignal },
  dependencies?: PreviewDependencies,
): Promise<LibraryPdfPreview> {
  const controller = new AbortController();
  let renderer: PreviewRenderer | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let document: PDFDocumentProxy | undefined;
  let activeRender: RenderTask | undefined;
  let activePage: PDFPageProxy | undefined;
  let activePageAbort: AbortController | undefined;
  let destroyed = false;
  let unavailableResource = false;
  const noteUnavailableResource = () => {
    unavailableResource = true;
  };
  // PDF.js can swallow a rejected resource request and resolve a blank fallback.
  // This explicit per-session signal detects that case without inspecting pixels/text.
  class ScopedPreviewResources extends NoPreviewExternalResources {
    async fetch() {
      noteUnavailableResource();
      return super.fetch();
    }
  }
  const checkResources = () => {
    if (unavailableResource)
      throw new LibraryPreviewError(
        "This PDF needs a rendering resource that is unavailable. Use Extracted text or download the original.",
      );
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    controller.abort();
    activePageAbort?.abort();
    activeRender?.cancel();
    activePage?.cleanup();
    void loadingTask?.destroy().catch(() => undefined);
    renderer?.destroy();
    scope.signal.removeEventListener("abort", destroy);
  };
  scope.signal.addEventListener("abort", destroy, { once: true });
  const check = () => {
    if (scope.signal.aborted || destroyed) throw new DOMException("Aborted", "AbortError");
  };
  try {
    check();
    await boundedOperation(
      (async () => {
        const readOriginal =
          dependencies?.readOriginal ??
          (await import("./library-original-client")).readOriginalLibraryFile;
        check();
        const blob = await readOriginal(
          scope.ownerId,
          scope.id,
          scope.generation,
          controller.signal,
        );
        check();
        if (
          blob.type !== "application/pdf" ||
          blob.size < 8 ||
          blob.size > LIBRARY_PDF_PREVIEW_LIMITS.bytes
        )
          throw new LibraryPreviewError("PDF preview requires a valid original PDF up to 10 MB.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        check();
        if (!/^%PDF-(?:1\.[0-7]|2\.0)/u.test(new TextDecoder().decode(bytes.subarray(0, 8))))
          throw new LibraryPreviewError("The original file is not a supported PDF.");
        const loadedRenderer = dependencies
          ? await dependencies.loadRenderer()
          : await (await import("./library-pdf-renderer")).createLibraryPdfRenderer();
        // A late dynamic import must not leave a worker running after a scope change.
        if (destroyed || scope.signal.aborted) {
          loadedRenderer.destroy();
          check();
        }
        renderer = loadedRenderer;
        loadingTask = renderer.getDocument(
          {
            data: bytes,
            disableFontFace: true,
            useSystemFonts: false,
            useWorkerFetch: false,
            useWasm: false,
            stopAtErrors: true,
            maxImageSize: LIBRARY_PDF_PREVIEW_LIMITS.pixels,
            canvasMaxAreaInBytes: LIBRARY_PDF_PREVIEW_LIMITS.pixels * 4,
            isOffscreenCanvasSupported: false,
            isImageDecoderSupported: false,
            enableXfa: false,
            disableRange: true,
            disableStream: true,
            disableAutoFetch: true,
            enableHWA: false,
            verbosity: 0,
            BinaryDataFactory: ScopedPreviewResources,
            CanvasFactory: BoundedPreviewCanvasFactory,
          },
          noteUnavailableResource,
        );
        document = await loadingTask.promise;
        check();
        checkResources();
        if (
          !Number.isInteger(document.numPages) ||
          document.numPages < 1 ||
          document.numPages > LIBRARY_PDF_PREVIEW_LIMITS.pages
        )
          throw new LibraryPreviewError("PDF preview supports up to 100 pages.");
      })(),
      controller.signal,
      LIBRARY_PDF_PREVIEW_LIMITS.loadMs,
      destroy,
    );
    check();
    return {
      pageCount: document!.numPages,
      destroy,
      async renderPage(number, canvas, signal, zoom = 1) {
        check();
        if (!Number.isInteger(number) || number < 1 || number > document!.numPages)
          throw new LibraryPreviewError("Choose an available PDF page.");
        // UI disables paging while drawing. Still reject concurrent calls defensively.
        if (activePageAbort)
          throw new LibraryPreviewError("Wait for the current PDF page to finish.");
        const pageController = new AbortController();
        activePageAbort = pageController;
        const abort = () => {
          pageController.abort();
          activeRender?.cancel();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        let page: PDFPageProxy | undefined;
        try {
          await boundedOperation(
            (async () => {
              pageController.signal.throwIfAborted();
              page = await document!.getPage(number);
              if (pageController.signal.aborted || destroyed) {
                page.cleanup();
                pageController.signal.throwIfAborted();
                check();
              }
              activePage = page;
              const native = page.getViewport({ scale: 1 });
              const size = boundedPreviewSize(native.width, native.height, zoom);
              const viewport = page.getViewport({ scale: size.scale });
              canvas.width = size.width;
              canvas.height = size.height;
              const context = canvas.getContext("2d", { alpha: false });
              if (!context)
                throw new LibraryPreviewError("PDF preview is unavailable in this browser.");
              activeRender = page.render({
                canvas,
                canvasContext: context,
                viewport,
                annotationMode: 0, // AnnotationMode.DISABLE: no forms, links or annotation appearances.
                background: "rgb(255, 255, 255)",
                isEditing: false,
              });
              await activeRender.promise;
              pageController.signal.throwIfAborted();
              check();
              checkResources();
            })(),
            pageController.signal,
            LIBRARY_PDF_PREVIEW_LIMITS.pageMs,
            destroy,
          );
        } catch (error) {
          canvas.width = canvas.height = 0;
          throw error;
        } finally {
          signal.removeEventListener("abort", abort);
          if (pageController.signal.aborted) canvas.width = canvas.height = 0;
          activeRender?.cancel();
          page?.cleanup();
          activeRender = undefined;
          activePage = undefined;
          activePageAbort = undefined;
        }
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
