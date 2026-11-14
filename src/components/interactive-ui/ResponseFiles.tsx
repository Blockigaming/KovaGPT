import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadBytes, safeDocumentFilename } from "@/lib/writing-export/common";
import type { FileBundleBlock } from "@/lib/interactive-ui.mjs";

const encoder = new TextEncoder();

export function ResponseFiles({ block }: { block: FileBundleBlock }) {
  const id = useId();
  const [open, setOpen] = useState<string>();
  const [savingZip, setSavingZip] = useState(false);
  const [error, setError] = useState("");
  const zipInProgress = useRef(false);

  async function saveZip() {
    if (zipInProgress.current) return;
    zipInProgress.current = true;
    setSavingZip(true);
    setError("");
    try {
      const { zipSync } = await import("fflate");
      const files = Object.fromEntries(
        block.files.map((file) => [file.name, encoder.encode(file.content)]),
      );
      downloadBytes(zipSync(files), "application/zip", safeDocumentFilename(block.title, "zip"));
    } catch {
      setError("Could not create the ZIP. Download the files individually.");
    } finally {
      zipInProgress.current = false;
      setSavingZip(false);
    }
  }

  return (
    <section
      aria-labelledby={id}
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <h3 id={id} className="text-base font-semibold">
        {block.title}
      </h3>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      <ul className="mt-3 divide-y divide-border">
        {block.files.map((file, index) => {
          const panel = `${id}-file-${index}`;
          const expanded = open === file.name;
          const bytes = encoder.encode(file.content);
          return (
            <li key={file.name} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bytes.byteLength.toLocaleString()} bytes
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    aria-controls={panel}
                    aria-expanded={expanded}
                    aria-label={`Preview ${file.name}`}
                    onClick={() => setOpen(expanded ? undefined : file.name)}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    aria-label={`Download ${file.name}`}
                    onClick={() => {
                      setError("");
                      try {
                        downloadBytes(bytes, "text/plain;charset=utf-8", file.name);
                      } catch {
                        setError(`Could not download ${file.name}.`);
                      }
                    }}
                  >
                    Download
                  </Button>
                </div>
              </div>
              <div id={panel} hidden={!expanded}>
                {expanded && (
                  <pre
                    tabIndex={0}
                    aria-label={`Contents of ${file.name}`}
                    className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-sm"
                  >
                    {file.content || "Empty file"}
                  </pre>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {block.files.length > 1 && (
        <Button
          type="button"
          variant="outline"
          className="mt-2 min-h-11"
          disabled={savingZip}
          onClick={() => void saveZip()}
        >
          {savingZip ? "Preparing ZIP…" : "Download ZIP"}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
