import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
}: {
  ownerId: string;
  item: LibraryItem;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [versions, setVersions] = useState<LibraryVersion[]>([]),
    [draft, setDraft] = useState(item.content_text ?? ""),
    [selected, setSelected] = useState(item.content_revision ?? 1),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [cleared, setCleared] = useState(false);
  const lifetime = useRef<ReturnType<typeof createWorkViewLifetime> | null>(null),
    sequence = useRef(0);
  useEffect(() => {
    const sequenceRef = sequence;
    const life = createWorkViewLifetime(ownerId, () => {
      sequence.current++;
      setVersions([]);
      setDraft("");
      setFile(null);
      setError("");
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
    };
  }, [ownerId, item.id, item.content_generation]);
  const run = async (action: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>) => {
    const life = lifetime.current;
    if (!life || life.controller.signal.aborted) return;
    const version = ++sequence.current,
      isCurrent = () => !life.controller.signal.aborted && version === sequence.current;
    setBusy(true);
    setError("");
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
  const save = () =>
    void run(async (signal, current) => {
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
      if (current()) onUpdated();
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogTitle>Versions of {item.title}</DialogTitle>
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
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <ul className="space-y-2">
              {versions.map((version) => (
                <li
                  key={`${version.kind}:${version.revision}:${version.generation ?? ""}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                >
                  <span className="text-sm">
                    Version {version.revision}
                    {version.current ? " · Current" : ""} · {version.file_name ?? "Saved text"}
                  </span>
                  <div className="flex gap-2">
                    {version.kind === "text" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => select(version)}
                      >
                        Read version
                      </Button>
                    )}
                    <Button
                      size="sm"
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
                    setFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
                {file && <span>{file.name}</span>}
                <span className="text-muted-foreground">
                  PDF, DOCX, XLSX or PPTX, up to 10 MB. The new original and extracted text replace
                  the current version together.
                </span>
              </label>
            ) : (
              <label className="grid gap-2 text-sm">
                Text from version {selected}
                <textarea
                  className="min-h-60 w-full rounded border bg-background p-3 font-mono"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
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
      </DialogContent>
    </Dialog>
  );
}
