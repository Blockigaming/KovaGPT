import { useMemo } from "react";
import { resultRevisionDiff } from "@/lib/result-revision-diff.mjs";

/** Compare actual saved versions or drafts. This never regenerates or saves. */
export function ResponseVersionDiff({ before, after }: { before: string; after: string }) {
  const chunks = useMemo(() => resultRevisionDiff(before, after), [before, after]);
  const changed = chunks.filter((chunk) => chunk.kind === "change");
  return (
    <section
      aria-label="Version comparison"
      className="my-3 rounded-xl border border-border bg-background p-3 text-sm"
    >
      <p role="status" className="mb-3 font-medium">
        {changed.length
          ? `${changed.length} changed ${changed.length === 1 ? "section" : "sections"}`
          : "No changes"}
      </p>
      {chunks.map((chunk, index) =>
        chunk.kind === "unchanged" ? (
          <pre
            key={index}
            className="whitespace-pre-wrap break-words font-sans text-muted-foreground"
          >
            {chunk.after}
          </pre>
        ) : (
          <div
            key={index}
            className="my-2 grid min-w-0 gap-3 border-y border-border py-3 sm:grid-cols-2"
          >
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Previous</p>
              <pre className="whitespace-pre-wrap break-words font-sans">
                <del>{chunk.before || "No previous text"}</del>
              </pre>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Current</p>
              <pre className="whitespace-pre-wrap break-words font-sans">
                <ins className="decoration-2">{chunk.after || "Text removed"}</ins>
              </pre>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
