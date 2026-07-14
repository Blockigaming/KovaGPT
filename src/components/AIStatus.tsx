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
 * Pick an initial "thinking" phrase based on the user's latest prompt so the
 * status feels varied, not the same "Thinking..." every time.
 */
function initialStatusForPrompt(prompt: string | undefined): string {
  const p = (prompt ?? "").toLowerCase();
  if (!p) return "Thinking";
  if (/(write|essay|paragraph|letter|email|draft|compose|story|poem)/.test(p)) return "Drafting";
  if (/(code|bug|error|function|api|typescript|python|regex|sql)/.test(p)) return "Working through the code";
  if (/(news|latest|today|breaking|headline|current)/.test(p)) return "Checking the latest";
  if (/(explain|why|how does|what is|define|meaning)/.test(p)) return "Piecing this together";
  if (/(compare|vs\b|versus|difference|better)/.test(p)) return "Weighing the options";
  if (/(summar|tl;dr|shorten|condense)/.test(p)) return "Distilling the key points";
  if (/(plan|schedule|itinerary|steps|roadmap)/.test(p)) return "Mapping out a plan";
  if (/(image|picture|photo|draw|render|generate|logo|design)/.test(p)) return "Sketching ideas";
  if (/(translate|in (spanish|french|german|italian|japanese|chinese|korean))/.test(p)) return "Translating";
  if (/(math|calculate|solve|equation|integral|derivative)/.test(p)) return "Running the numbers";
  if (/(search|find|look up|google|research)/.test(p)) return "Digging in";
  if (/(idea|brainstorm|suggest|recommend)/.test(p)) return "Brainstorming";
  if (/(chart|graph|plot|visuali[sz]e|data)/.test(p)) return "Charting it out";
  if (/(fix|debug|why (isn'?t|doesn'?t|won'?t))/.test(p)) return "Tracing the issue";
  if (/(location|where am i|near me|weather)/.test(p)) return "Checking nearby";
  if (/(joke|funny|laugh)/.test(p)) return "Working on a good one";
  if (p.split(/\s+/).length > 40) return "Reading it through";
  return "Thinking";
}

function deriveStatus(
  message: Message | undefined,
  streaming: boolean,
  lastUserPrompt: string | undefined,
): string | null {
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
  return initialStatusForPrompt(lastUserPrompt);
}

export function AIStatus({
  message,
  streaming,
  lastUserPrompt,
}: {
  message?: Message;
  streaming: boolean;
  lastUserPrompt?: string;
}) {
  const status = deriveStatus(message, streaming, lastUserPrompt);
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
