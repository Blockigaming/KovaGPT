import { useEffect, useState } from "react";
import type { Activity } from "@/lib/chat-store";

const CONTINUED_WAIT_MS = 8_000;
const EXTENDED_WAIT_MS = 30_000;

type WaitStage = "initial" | "continued" | "extended";

function waitStageAt(startedAt: number): WaitStage {
  const elapsed = Math.max(0, Date.now() - startedAt);
  if (elapsed >= EXTENDED_WAIT_MS) return "extended";
  if (elapsed >= CONTINUED_WAIT_MS) return "continued";
  return "initial";
}

export function StreamingStatus({
  activities,
  startedAt,
}: {
  activities?: import("@/lib/chat-store").Activity[];
  startedAt: number;
  onSkipThinking?: () => void;
}) {
  const [waitStage, setWaitStage] = useState<WaitStage>(() => waitStageAt(startedAt));
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);
  useEffect(() => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    setWaitStage(waitStageAt(startedAt));
    const continuedTimer =
      elapsed < CONTINUED_WAIT_MS
        ? window.setTimeout(() => setWaitStage("continued"), CONTINUED_WAIT_MS - elapsed)
        : null;
    const extendedTimer =
      elapsed < EXTENDED_WAIT_MS
        ? window.setTimeout(() => setWaitStage("extended"), EXTENDED_WAIT_MS - elapsed)
        : null;
    return () => {
      if (continuedTimer !== null) window.clearTimeout(continuedTimer);
      if (extendedTimer !== null) window.clearTimeout(extendedTimer);
    };
  }, [startedAt]);

  const active =
    activities
      ?.slice()
      .reverse()
      .find((activity) => activity.status === "running") ?? null;
  const tool = (active?.tool ?? "").toLowerCase();
  let label =
    waitStage === "extended"
      ? "Taking a little longer"
      : waitStage === "continued"
        ? "Still working"
        : "Working";
  if (tool) {
    if (tool.includes("image")) label = "Creating image";
    else if (tool.includes("gmail") || tool.includes("mail")) label = "Checking Gmail";
    else if (tool.includes("calendar")) label = "Checking Calendar";
    else if (tool.includes("drive") || tool.includes("file") || tool.includes("read"))
      label = "Reading documents";
    else if (tool.includes("memory") || tool.includes("recall")) label = "Searching memory";
    else if (tool.includes("search") || tool.includes("web") || tool.includes("browse"))
      label = "Searching the web";
    else if (tool.includes("write")) label = "Writing draft";
    else if (tool.includes("github")) label = "Using GitHub";
    else label = active?.label ?? "Working";
  }
  if (elapsedSeconds < 1) return null;
  return (
    <div
      className="kova-thinking-indicator flex min-h-8 flex-col gap-2 py-1"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-wait-stage={waitStage}
    >
      <span className="text-sm text-muted-foreground">
        Working for {elapsedSeconds}s
        {label !== "Working" && label !== "Still working" && label !== "Taking a little longer"
          ? ` · ${label}`
          : ""}
      </span>
    </div>
  );
}
