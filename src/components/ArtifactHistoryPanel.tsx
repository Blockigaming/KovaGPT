import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Shares Comments' phone bottom-sheet placement; desktop remains a sidebar. */
export function ArtifactHistoryPanel({
  summary,
  onClose,
  children,
}: {
  summary: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      className="kova-artifact-history shrink-0 overflow-y-auto border-l border-border bg-[var(--surface-secondary)] p-3"
      aria-label="Version history"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold">
          Version history
        </h2>
        <button
          type="button"
          className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-accent"
          aria-label="Close version history"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{summary}</p>
      {children}
    </aside>
  );
}
