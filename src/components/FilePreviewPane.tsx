import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/localization";
import {
  Check,
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileText,
  Globe,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { buildFilePreviewDocument, type ResponseFile } from "@/lib/response-files.mjs";
import { downloadResponseFile } from "@/lib/response-file-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import "./response-file-pane.css";

const GeneratedPdfPreview = lazy(() =>
  import("./generative-ui/GeneratedPdfPreview").then((module) => ({
    default: module.GeneratedPdfPreview,
  })),
);

type View = "preview" | "code";

// Kept local (not shared with the chat bundle) so opening the pane adds no shared chunk.
function paneIcon(file: ResponseFile) {
  if (file.language === "html") return Globe;
  if (file.language === "svg") return ImageIcon;
  return file.category === "Document" ? FileText : Code2;
}
function download(file: ResponseFile) {
  void downloadResponseFile(file).catch(() => toast.error("Download failed. Try again."));
}
type CopyState = "idle" | "copied" | "error";

/**
 * Side preview for a file Kova made: Preview/Code toggle, Copy with a Download menu,
 * restart, full screen and close. HTML runs in an opaque-origin sandbox with no
 * network; SVG and Markdown never run scripts.
 */
export function FilePreviewPane({
  file,
  onClose,
  renderMarkdown,
}: {
  file: ResponseFile;
  onClose: () => void;
  /** Supplied by the chat when available; Markdown otherwise opens as source. */
  renderMarkdown?: (text: string) => ReactNode;
}) {
  const previewable = file.preview && (file.language !== "markdown" || Boolean(renderMarkdown));
  const [view, setView] = useState<View>(previewable ? "preview" : "code");
  const [fullscreen, setFullscreen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [run, setRun] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingId = useId();
  const Icon = paneIcon(file);

  useEffect(() => {
    setView(previewable ? "preview" : "code");
    setCopyState("idle");
  }, [file.name, file.content, previewable]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const previewDoc = useMemo(
    () =>
      file.language === "html" || file.language === "svg" ? buildFilePreviewDocument(file) : "",
    [file],
  );

  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(file.content);
      setCopyState("copied");
      copyTimer.current = setTimeout(() => setCopyState("idle"), 1_600);
    } catch {
      setCopyState("error");
      toast.error("Couldn’t copy. Switch to Code to select the file.");
    }
  };

  return (
    <section
      className="kova-file-pane"
      data-fullscreen={fullscreen || undefined}
      aria-labelledby={headingId}
    >
      <header className="kova-file-pane-header">
        <span className="kova-file-pane-icon" aria-hidden="true">
          <Icon />
        </span>
        <h2 id={headingId} className="kova-file-pane-name" title={file.name}>
          {file.name}
        </h2>
        <div className="kova-file-pane-tools">
          {previewable && (
            <div className="kova-file-pane-toggle" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={view === "preview"}
                aria-label="Preview"
                title="Preview"
                onClick={() => setView("preview")}
              >
                <Eye aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={view === "code"}
                aria-label="Code"
                title="Code"
                onClick={() => setView("code")}
              >
                <Code2 aria-hidden="true" />
              </button>
            </div>
          )}
          {file.language === "html" && view === "preview" && (
            <button
              type="button"
              className="kova-file-pane-icon-button"
              aria-label="Restart preview"
              title="Restart preview"
              onClick={() => setRun((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          )}
          <div className="kova-file-pane-copy">
            <button
              type="button"
              className="kova-file-pane-copy-main"
              onClick={() => void copy()}
              aria-label={copyState === "copied" ? "Copied" : `Copy ${file.name}`}
            >
              {copyState === "copied" ? <Check aria-hidden="true" /> : null}
              {copyState === "copied" ? t("Copied") : t("Copy")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="kova-file-pane-copy-more"
                  aria-label="More file actions"
                >
                  <ChevronDown aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onSelect={() => void copy()}>Copy</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => download(file)}>
                  <Download aria-hidden="true" /> Download {file.name}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button
            type="button"
            className="kova-file-pane-icon-button"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen" : "Full screen"}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((value) => !value)}
          >
            <Maximize2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="kova-file-pane-icon-button"
            aria-label="Close preview"
            title="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      <span role="status" className="sr-only">
        {copyState === "copied" ? `${file.name} copied.` : ""}
      </span>
      <div className="kova-file-pane-body" data-view={view}>
        {view === "preview" && file.language === "html" ? (
          <iframe
            key={run}
            title={`Preview of ${file.name}`}
            className="kova-file-pane-frame"
            // Opaque origin: never add allow-same-origin, forms, popups or navigation.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={previewDoc}
          />
        ) : view === "preview" && file.language === "svg" ? (
          <iframe
            title={`Preview of ${file.name}`}
            className="kova-file-pane-frame"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={previewDoc}
          />
        ) : view === "preview" && file.language === "pdf" ? (
          <div className="kova-file-pane-document">
            <Suspense fallback={<p role="status">Preparing PDF preview…</p>}>
              <GeneratedPdfPreview
                key={JSON.stringify([file.name, file.content])}
                title={file.name.replace(/\.pdf$/iu, "")}
                content={file.content}
                blankLetter
              />
            </Suspense>
          </div>
        ) : view === "preview" && file.language === "markdown" && renderMarkdown ? (
          <div className="kova-file-pane-document prose-chat" tabIndex={0}>
            {renderMarkdown?.(file.content)}
          </div>
        ) : (
          <pre
            className="kova-file-pane-code"
            dir="ltr"
            tabIndex={0}
            aria-label={`${file.languageLabel} source of ${file.name}`}
          >
            <code>
              {file.content.split("\n").map((line, index) => (
                <span key={index} className="kova-file-pane-line">
                  {line || " "}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </section>
  );
}
