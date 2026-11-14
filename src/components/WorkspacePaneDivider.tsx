import type { RefObject } from "react";

export function WorkspacePaneDivider({
  workspaceRef,
  label,
  className = "spec400-pane-divider",
  minimum = 20,
  maximum = 80,
  paneRatio,
  setLayoutRatio,
  setPaneRatio,
}: {
  label: string;
  className?: string;
  minimum?: number;
  maximum?: number;
  workspaceRef: RefObject<HTMLDivElement | null>;
  paneRatio: number;
  setLayoutRatio: (next: number) => void;
  setPaneRatio: (next: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(paneRatio * 100)}
      tabIndex={0}
      className={className}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = workspaceRef.current?.getBoundingClientRect();
        if (bounds) setLayoutRatio((event.clientX - bounds.left) / bounds.width);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setLayoutRatio(paneRatio + (event.key === "ArrowLeft" ? -0.02 : 0.02));
        } else if (event.key === "Home") {
          event.preventDefault();
          setPaneRatio(0.45);
        }
      }}
    />
  );
}
