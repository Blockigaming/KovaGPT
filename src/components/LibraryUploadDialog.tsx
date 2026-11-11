import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  LIBRARY_ORIGINAL_MAX_BYTES,
  ORIGINAL_DOCUMENT_MIMES,
} from "@/lib/library-original-policy.mjs";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";

/** Uses the existing original-document upload, extraction and server quota contracts. */
export function LibraryUploadDialog({
  ownerId,
  onClose,
  onSaved,
}: {
  ownerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "uploading" | "ready" | "failed">(
    "idle",
  );
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const busy = status === "processing" || status === "uploading";
  const busyRef = useRef(false);
  const operationId = useRef<string | null>(null);
  const life = useRef<ReturnType<typeof createWorkViewLifetime> | null>(null);
  const uploaded = useRef(false);
  useEffect(() => {
    const lifetime = createWorkViewLifetime(ownerId, () => {
      setFile(null);
      setError("Your account changed. Reopen Upload to continue.");
    });
    life.current = lifetime;
    return () => {
      lifetime.dispose();
      life.current = null;
    };
  }, [ownerId]);
  async function upload() {
    const current = life.current;
    if (
      !file ||
      !current ||
      current.controller.signal.aborted ||
      busyRef.current ||
      uploaded.current
    )
      return;
    if (
      file.size < 8 ||
      file.size > LIBRARY_ORIGINAL_MAX_BYTES ||
      !ORIGINAL_DOCUMENT_MIMES[file.name.split(".").pop()?.toLowerCase() ?? ""]
    ) {
      setError("Choose a supported document within the file-size limit.");
      publishKovaNotice({
        id: file.size > LIBRARY_ORIGINAL_MAX_BYTES ? "file_too_large" : "unsupported_file",
        title: "This file cannot be uploaded",
        message: "Choose a supported document within the file-size limit.",
      });
      return;
    }
    busyRef.current = true;
    setStatus("processing");
    setError("");
    publishKovaNotice({
      id: "file_processing",
      title: "Preparing document",
      message: file.name,
      key: "library-processing:" + file.name,
    });
    try {
      const { extractDocumentFile } = await import("@/lib/document-extraction/client");
      const extracted = await extractDocumentFile(file, current.controller.signal);
      current.controller.signal.throwIfAborted();
      setNote(extracted.note);
      setStatus("uploading");
      publishKovaNotice({
        id: "upload_started",
        title: "Uploading document",
        message: file.name,
        key: "library-upload:" + (operationId.current ?? file.name),
      });
      const { saveOriginalLibraryFile } = await import("@/lib/library-original-client");
      operationId.current ??= crypto.randomUUID();
      await saveOriginalLibraryFile(
        ownerId,
        operationId.current,
        file,
        extracted.text,
        current.controller.signal,
      );
      current.controller.signal.throwIfAborted();
      uploaded.current = true;
      setStatus("ready");
      publishKovaNotice({
        id: "upload_completed",
        title: "File uploaded",
        message: file.name,
        confirmed: true,
      });
      onSaved();
    } catch (cause) {
      if (!current.controller.signal.aborted) {
        setStatus("failed");
        publishKovaNotice({
          id:
            cause instanceof Error && /limit|quota|allowance/i.test(cause.message)
              ? "upload_limit"
              : "upload_failed",
          title: "Upload not completed",
          message: "Your file selection is preserved.",
        });
        setError(
          cause instanceof Error
            ? cause.message
            : "The upload could not be confirmed. Your file selection is preserved.",
        );
      }
    } finally {
      busyRef.current = false;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="spec400-management-dialog"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>Upload to Library</DialogTitle>
        <DialogDescription>
          Upload a document and extract its readable text. Your account’s existing upload and
          storage limits still apply.
        </DialogDescription>
        <p className="spec400-supporting">
          {Object.keys(ORIGINAL_DOCUMENT_MIMES)
            .map((extension) => extension.toUpperCase())
            .join(", ")}{" "}
          · Up to {LIBRARY_ORIGINAL_MAX_BYTES / (1024 * 1024)} MB per file. Remaining allowance is
          checked by the server when you upload.
        </p>
        <label className="spec400-upload-label">
          Document
          <input
            type="file"
            accept={Object.keys(ORIGINAL_DOCUMENT_MIMES)
              .map((extension) => `.${extension}`)
              .join(",")}
            disabled={busy || status === "ready"}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected) {
                publishKovaNotice({
                  id: "file_selected",
                  title: "File selected",
                  message: selected.name,
                });
              }
              operationId.current = null;
              setStatus("idle");
              setError("");
              setNote("");
            }}
          />
        </label>
        {file && <p className="break-words">{file.name}</p>}
        {status !== "idle" && (
          <p role="status">
            {status === "processing"
              ? "Processing document text…"
              : status === "uploading"
                ? "Uploading original document…"
                : status === "ready"
                  ? "Ready. Original document and extracted text saved to Library."
                  : "Upload not completed"}
          </p>
        )}
        {note && <p className="spec400-supporting">{note}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="spec400-form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {status === "ready" ? "Close" : "Cancel"}
          </Button>
          {status !== "ready" && (
            <Button disabled={!file || busy} onClick={() => void upload()}>
              {busy ? (
                <span className="spec400-loading-label">
                  <span className="spec400-loading-spinner" aria-hidden="true" />
                  Saving…
                </span>
              ) : status === "failed" ? (
                "Retry same upload"
              ) : (
                "Upload document"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
