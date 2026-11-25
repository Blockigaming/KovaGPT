import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ResponseFile } from "@/lib/response-files.mjs";
import { downloadResponseFile, fileIcon } from "@/lib/response-file-actions";
import "./response-files.css";

/** A file Kova made: one card under the reply that opens the side preview. */
export function ResponseFileCard({
  file,
  active = false,
  interrupted = false,
  onOpen,
}: {
  file: ResponseFile;
  active?: boolean;
  interrupted?: boolean;
  onOpen: (file: ResponseFile, trigger: HTMLButtonElement) => void;
}) {
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const Icon = fileIcon(file);
  const incomplete = !file.complete;
  const writing = incomplete && !interrupted;
  return (
    <div
      className="kova-file-card"
      data-active={active || undefined}
      data-state={writing ? "writing" : incomplete ? "interrupted" : "ready"}
    >
      <button
        type="button"
        className="kova-file-card-open"
        aria-label={
          writing
            ? `Writing ${file.name}`
            : incomplete
              ? `Incomplete file ${file.name}`
              : `Open ${file.name} in preview, ${file.category} · ${file.languageLabel}`
        }
        aria-pressed={active}
        disabled={incomplete}
        onClick={(event) => onOpen(file, event.currentTarget)}
      >
        <span className="kova-file-card-icon" aria-hidden="true">
          {writing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Icon />}
        </span>
        <span className="kova-file-card-text">
          <span className="kova-file-card-title">{file.title}</span>
          <span className="kova-file-card-meta">
            {writing
              ? `Writing ${file.name}… ${file.lines.toLocaleString()} ${file.lines === 1 ? "line" : "lines"}`
              : incomplete
                ? "Generation interrupted. Retry the response."
                : downloadError
                  ? "Download failed. Try again."
                  : `${file.category} · ${file.languageLabel}`}
          </span>
        </span>
      </button>
      {!incomplete && (
        <button
          type="button"
          className="kova-file-card-download"
          aria-label={`Download ${file.name}`}
          title="Download"
          disabled={downloading}
          onClick={() => {
            setDownloading(true);
            setDownloadError(false);
            void downloadResponseFile(file)
              .catch(() => setDownloadError(true))
              .finally(() => setDownloading(false));
          }}
        >
          {downloading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}
