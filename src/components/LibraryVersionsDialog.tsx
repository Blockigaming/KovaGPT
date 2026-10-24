import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Button } from "@/components/ui/button";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
import { libraryItemsRequest, type LibraryVersion } from "@/lib/library-items-client";
import { readOriginalLibraryFile, saveOriginalLibraryFile } from "@/lib/library-original-client";
import type { LibraryItem } from "@/lib/library.functions";
export function LibraryVersionsDialog({
  ownerId,
  item,
  onClose,
  onUpdated,
  onCloseAutoFocus,
}: {
  ownerId: string;
  item: LibraryItem;
  onClose: () => void;
  onUpdated: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [versions, setVersions] = useState<LibraryVersion[]>([]),
    [draft, setDraft] = useState(item.content_text ?? ""),
    [loadedText, setLoadedText] = useState(item.content_text ?? ""),
    [selected, setSelected] = useState(item.content_revision ?? 1),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [textSaveFailed, setTextSaveFailed] = useState(false),
    [cleared, setCleared] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false);
  const contextKey = `${ownerId}:${item.id}:${item.content_generation}:${item.content_revision}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const discardDecisionRef = useRef<"closed" | "pending" | "discard">("closed");
  const discardReturnRef = useRef<{
    target: HTMLElement | null;
    url: string;
    life: ReturnType<typeof createWorkViewLifetime>;
  } | null>(null);
  const lifetime = useRef<ReturnType<typeof createWorkViewLifetime> | null>(null),
    sequence = useRef(0);
  useEffect(() => {
    const sequenceRef = sequence;
    setVersions([]);
    setDraft(item.content_text ?? "");
    setLoadedText(item.content_text ?? "");
    setSelected(item.content_revision ?? 1);
    setFile(null);
    setError("");
    setTextSaveFailed(false);
    setBusy(true);
    setCleared(false);
    setDiscardOpen(false);
    savingRef.current = false;
    discardDecisionRef.current = "closed";
    discardReturnRef.current = null;
    const life = createWorkViewLifetime(ownerId, () => {
      sequence.current++;
      setVersions([]);
      setDraft("");
      setLoadedText("");
      setFile(null);
      setDiscardOpen(false);
      savingRef.current = false;
      discardDecisionRef.current = "closed";
      discardReturnRef.current = null;
      setError("");
      setTextSaveFailed(false);
      setBusy(false);
      setCleared(true);
    });
    lifetime.current = life;
    const version = ++sequence.current;
    void libraryItemsRequest(
      ownerId,
      `?id=${item.id}&generation=${item.content_generation}&history=1`,
      life.controller.signal,
    )
      .then((value) => {
        if (life.controller.signal.aborted || version !== sequence.current) return;
        if (
          value.supported !== true ||
          !Array.isArray(value.versions) ||
          value.versions.length > 50
        )
          throw new Error("This Library type uses its own generation or output history.");
        setVersions(value.versions);
      })
      .catch((cause) => {
        if (!life.controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!life.controller.signal.aborted) setBusy(false);
      });
    return () => {
      sequenceRef.current++;
      life.dispose();
      lifetime.current = null;
      discardDecisionRef.current = "closed";
      discardReturnRef.current = null;
    };
  }, [ownerId, item.id, item.content_generation, item.content_revision, item.content_text]);
  const dirty = !cleared && (file !== null || draft !== loadedText);
  const requestClose = () => {
    if (contextRef.current !== contextKey || savingRef.current) return;
    const life = lifetime.current;
    if (!life || life.controller.signal.aborted) {
      if (cleared) onClose();
      return;
    }
    if (discardDecisionRef.current !== "closed") return;
    if (dirty) {
      const content = contentRef.current;
      const focused = content?.ownerDocument.activeElement;
      discardReturnRef.current = {
        target:
          focused instanceof HTMLElement && content?.contains(focused)
            ? focused
            : headingRef.current,
        url: window.location.href,
        life,
      };
      discardDecisionRef.current = "pending";
      setDiscardOpen(true);
    } else onClose();
  };
  const run = async (action: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>) => {
    const life = lifetime.current;
    if (
      !life ||
      life.controller.signal.aborted ||
      contextRef.current !== contextKey ||
      savingRef.current ||
      discardDecisionRef.current !== "closed"
    )
      return;
    const version = ++sequence.current,
      isCurrent = () =>
        !life.controller.signal.aborted &&
        version === sequence.current &&
        contextRef.current === contextKey;
    setBusy(true);
    setError("");
    setTextSaveFailed(false);
    try {
      await action(life.controller.signal, isCurrent);
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "The version request failed.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const select = (version: LibraryVersion) =>
    void run(async (signal, current) => {
      const value = await libraryItemsRequest(
        ownerId,
        `?id=${item.id}&generation=${item.content_generation}&revision=${version.revision}`,
        signal,
      );
      if (current()) {
        setDraft(value.content_text);
        setLoadedText(value.content_text);
        setSelected(version.revision);
      }
    });
  const download = (version: LibraryVersion) =>
    void run(async (signal, current) => {
      let blob: Blob;
      if (version.kind === "original") {
        if (!version.generation) throw new Error("Refresh this version list.");
        blob = await readOriginalLibraryFile(ownerId, item.id, version.generation, signal);
      } else {
        const value = await libraryItemsRequest(
          ownerId,
          `?id=${item.id}&generation=${item.content_generation}&revision=${version.revision}`,
          signal,
        );
        blob = new Blob([value.content_text], { type: "text/plain;charset=utf-8" });
      }
      if (!current()) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download =
        version.file_name ?? `${item.title.replace(/[\p{Cc}/\\]/gu, "_")}-v${version.revision}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const save = () => {
    if (savingRef.current) return;
    void run(async (signal, current) => {
      savingRef.current = true;
      try {
        if (item.original_generation) {
          if (!file) throw new Error("Choose a replacement document.");
          const { extractDocumentFile } = await import("@/lib/document-extraction/client");
          if (!current()) return;
          const extracted = await extractDocumentFile(file, signal);
          if (!current()) return;
          await saveOriginalLibraryFile(
            ownerId,
            item.id,
            file,
            extracted.text,
            signal,
            item.original_generation,
          );
        } else {
          await libraryItemsRequest(ownerId, "", signal, {
            operation: "replace_text",
            id: item.id,
            generation: item.content_generation,
            revision: item.content_revision,
            text: draft,
          });
        }
        if (current()) {
          setLoadedText(draft);
          setFile(null);
          onUpdated();
        }
      } catch (cause) {
        if (current() && !item.original_generation) setTextSaveFailed(true);
        throw cause;
      } finally {
        if (current()) savingRef.current = false;
      }
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        className="spec400-library-inspector"
        closeLabel="Close versions"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (savingRef.current || discardDecisionRef.current !== "closed") event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (savingRef.current || discardDecisionRef.current !== "closed") event.preventDefault();
        }}
      >
        <header className="spec400-library-inspector-header shrink-0 border-b border-border">
          <div className="spec400-library-inspector-title">
            <DialogTitle ref={headingRef} tabIndex={-1}>
              Versions of {item.title}
            </DialogTitle>
          </div>
        </header>
        <div className="spec400-inspector-body flex-1 space-y-4">
          <DialogDescription>
            Replacements keep earlier versions private. Retained originals and text history count
            toward storage. Images and Work outputs keep their own generation history.
          </DialogDescription>
          {cleared ? (
            <p>This browser’s saved data was cleared. Close and reload Library.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Up to 50 versions per item. Deleting this item revokes every version and schedules
                removal of its original files.
              </p>
              {error && (
                <>
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                  {textSaveFailed && !item.original_generation && draft && draft !== loadedText && (
                    <p className="text-sm">
                      Your unsaved text is still here. Select and copy anything you want to keep
                      before closing. Refresh Library, then reopen Versions to check the saved text.
                    </p>
                  )}
                </>
              )}
              <ul className="space-y-2">
                {versions.map((version) => (
                  <li
                    key={`${version.kind}:${version.revision}:${version.generation ?? ""}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <span className="min-w-0 break-words text-sm">
                      Version {version.revision}
                      {version.current ? " · Current" : ""} · {version.file_name ?? "Saved text"}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {version.kind === "text" && (
                        <Button
                          size="sm"
                          className="min-h-11"
                          aria-label={`Read version ${version.revision}`}
                          variant="outline"
                          disabled={busy}
                          onClick={() => select(version)}
                        >
                          Read version
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="min-h-11"
                        aria-label={`Download version ${version.revision}`}
                        variant="outline"
                        disabled={busy}
                        onClick={() => download(version)}
                      >
                        Download
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {item.original_generation ? (
                <label className="grid gap-2 text-sm">
                  Replace original document
                  <input
                    type="file"
                    accept=".pdf,.docx,.xlsx,.pptx"
                    disabled={busy}
                    onChange={(event) => {
                      if (
                        contextRef.current !== contextKey ||
                        !lifetime.current ||
                        lifetime.current.controller.signal.aborted ||
                        busy
                      )
                        return;
                      setFile(event.target.files?.[0] ?? null);
                      event.target.value = "";
                    }}
                  />
                  {file && <span>{file.name}</span>}
                  <span className="text-muted-foreground">
                    PDF, DOCX, XLSX or PPTX, up to 10 MB. The new original and extracted text
                    replace the current version together.
                  </span>
                </label>
              ) : (
                <label className="grid gap-2 text-sm">
                  Text from version {selected}
                  <textarea
                    className="min-h-60 w-full rounded-xl border bg-background p-3 font-mono"
                    value={draft}
                    onChange={(event) => {
                      if (
                        contextRef.current !== contextKey ||
                        !lifetime.current ||
                        lifetime.current.controller.signal.aborted ||
                        busy
                      )
                        return;
                      setDraft(event.target.value);
                    }}
                    disabled={busy}
                    maxLength={300000}
                  />
                  <span className="text-muted-foreground">
                    Saving preserves the current text as an earlier version. Text is limited to 300
                    KB.
                  </span>
                </label>
              )}
              <Button
                disabled={busy || versions.length === 0 || (!!item.original_generation && !file)}
                onClick={save}
              >
                {busy
                  ? "Working…"
                  : item.original_generation
                    ? "Save replacement as new version"
                    : "Save text as new version"}
              </Button>
            </>
          )}
        </div>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const origin = discardReturnRef.current;
              if (
                origin?.life === lifetime.current &&
                !origin.life.controller.signal.aborted &&
                contextRef.current === contextKey &&
                window.location.href === origin.url
              )
                keepEditingRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const decision = discardDecisionRef.current;
              const origin = discardReturnRef.current;
              discardDecisionRef.current = "closed";
              discardReturnRef.current = null;
              if (
                !origin ||
                origin.life !== lifetime.current ||
                origin.life.controller.signal.aborted ||
                contextRef.current !== contextKey ||
                !contentRef.current?.isConnected ||
                window.location.href !== origin.url
              )
                return;
              const active = document.activeElement;
              if (
                active !== null &&
                active !== document.body &&
                !contentRef.current.contains(active) &&
                !(event.target instanceof HTMLElement && event.target.contains(active))
              )
                return;
              if (decision === "discard") {
                // Finish the nested scope first, then let the inspector restore its exact page opener.
                headingRef.current?.focus({ preventScroll: true });
                onClose();
              } else {
                const previous = origin.target;
                restoreDialogFocus(
                  previous?.isConnected && !previous.matches(":disabled")
                    ? previous
                    : headingRef.current,
                  origin.url,
                );
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved version changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Your unsaved changes to “{item.title}” will be lost. Saved versions will be kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={keepEditingRef} type="button">
                Keep editing
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  const origin = discardReturnRef.current;
                  if (
                    savingRef.current ||
                    discardDecisionRef.current !== "pending" ||
                    !origin ||
                    origin.life !== lifetime.current ||
                    origin.life.controller.signal.aborted ||
                    contextRef.current !== contextKey
                  ) {
                    event.preventDefault();
                    return;
                  }
                  discardDecisionRef.current = "discard";
                }}
              >
                Discard changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
