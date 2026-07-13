import { useEffect, useRef, useState } from "react";
import { NovaLogo } from "@/components/NovaLogo";
import type { Message } from "@/lib/chat-store";

/** Map a tool identifier to a human status label. */
const TOOL_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /gmail|mail/i, label: "Looking through Gmail" },
  { match: /calendar|event/i, label: "Checking Calendar" },
  { match: /drive|doc(s)?$/i, label: "Searching Drive" },
  { match: /web[_-]?search|search[_-]?web|browse|bing|google/i, label: "Searching the web" },
  { match: /search/i, label: "Searching" },
  { match: /image|photo|picture|dalle|nano/i, label: "Creating image" },
  { match: /code|python|shell|exec/i, label: "Generating code" },
  { match: /read|parse|document|pdf|file/i, label: "Reading documents" },
  { match: /summar/i, label: "Summarizing" },
  { match: /plan/i, label: "Planning" },
  { match: /think|reason/i, label: "Reasoning" },
  { match: /write|draft|compose/i, label: "Writing draft" },
  { match: /fact|verify|check/i, label: "Double-checking facts" },
  { match: /research/i, label: "Researching" },
  { match: /project/i, label: "Searching Projects" },
];

function toolToLabel(tool: string | undefined): string | null {
  if (!tool) return null;
  for (const t of TOOL_LABELS) if (t.match.test(tool)) return t.label;
  return null;
}

/**
 * Given the current streaming assistant message and streaming flag,
 * return the human status string, or null to hide.
 */
function deriveStatus(message: Message | undefined, streaming: boolean): string | null {
  if (!streaming) return null;
  const acts = message?.activities;
  const last = acts && acts.length > 0 ? acts[acts.length - 1] : undefined;
  if (last) {
    // Prefer explicit label from server, else map tool name.
    const fromTool = toolToLabel(last.tool);
    const label = (last.label && last.label.trim()) || fromTool || "Working";
    return label.replace(/[.…]+$/, "");
  }
  if (message?.content && message.content.trim().length > 0) {
    // Content already streaming: shift to "Writing" phase.
    return message.content.length < 220 ? "Writing draft" : "Finalizing response";
  }
  return "Thinking";
}

export function AIStatus({
  message,
  streaming,
}: {
  message?: Message;
  streaming: boolean;
}) {
  const status = deriveStatus(message, streaming);
  const [display, setDisplay] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (status) {
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      setVisible(true);
      if (status !== display) {
        setDisplay(status);
        setAnimKey((k) => k + 1);
      }
    } else {
      // fade out, then unmount
      setVisible(false);
      fadeTimer.current = window.setTimeout(() => {
        setDisplay(null);
        fadeTimer.current = null;
      }, 300);
    }
    return () => {
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [status, display]);

  if (!display) return null;

  return (
    <div
      className={`flex items-center gap-2 min-w-0 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="inline-flex shrink-0 items-center justify-center h-6 w-6">
        <NovaLogo className="w-6 h-6" />
      </span>
      <span
        key={animKey}
        className="ai-status-label inline-flex items-baseline text-[13px] font-medium text-muted-foreground leading-none truncate"
      >
        <span className="truncate">{display}</span>
        <span className="ai-status-dots ml-0.5" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  );
}
