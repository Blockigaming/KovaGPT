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

const GENERIC_PHRASES = [
  "Thinking",
  "Pondering",
  "Considering",
  "Weighing this",
  "Framing the answer",
  "Drafting",
  "Composing",
  "Working on it",
  "Piecing it together",
  "Almost there",
  "Reasoning",
  "Reading between the lines",
  "Cross-checking",
  "Double-checking",
  "Warming up",
  "Getting my bearings",
  "Lining up the details",
  "Pulling this together",
  "Turning it over",
  "Sketching a reply",
  "Refining",
  "Polishing",
  "Structuring this",
  "Tidying the response",
  "Tightening the wording",
  "Weighing the trade-offs",
  "Sanity checking",
  "Making sure this is right",
  "Getting specific",
  "Homing in",
];

const PROMPT_BUCKETS: Array<{ match: RegExp; phrases: string[] }> = [
  {
    match: /(write|essay|paragraph|letter|email|draft|compose|story|poem)/,
    phrases: [
      "Drafting",
      "Finding the voice",
      "Outlining",
      "Choosing words",
      "Polishing the phrasing",
      "Reworking a line",
      "Reading it back",
    ],
  },
  {
    match: /(code|bug|error|function|api|typescript|python|regex|sql)/,
    phrases: [
      "Working through the code",
      "Tracing the logic",
      "Checking the syntax",
      "Running it in my head",
      "Lining up the types",
      "Testing edge cases",
    ],
  },
  {
    match: /(news|latest|today|breaking|headline|current)/,
    phrases: [
      "Checking the latest",
      "Scanning fresh sources",
      "Pulling recent updates",
      "Confirming the timeline",
    ],
  },
  {
    match: /(explain|why|how does|what is|define|meaning)/,
    phrases: [
      "Piecing this together",
      "Finding the clearest way to say it",
      "Boiling it down",
      "Choosing the right analogy",
    ],
  },
  {
    match: /(compare|vs\b|versus|difference|better)/,
    phrases: ["Weighing the options", "Comparing the trade-offs", "Lining them up side by side"],
  },
  {
    match: /(summar|tl;dr|shorten|condense)/,
    phrases: ["Distilling the key points", "Trimming the fat", "Getting to the essentials"],
  },
  {
    match: /(plan|schedule|itinerary|steps|roadmap)/,
    phrases: ["Mapping out a plan", "Ordering the steps", "Sequencing this out"],
  },
  {
    match: /(image|picture|photo|draw|render|generate|logo|design)/,
    phrases: ["Sketching ideas", "Visualizing this", "Blocking out the composition"],
  },
  {
    match: /(translate|in (spanish|french|german|italian|japanese|chinese|korean))/,
    phrases: ["Translating", "Matching the tone", "Choosing the right phrasing"],
  },
  {
    match: /(math|calculate|solve|equation|integral|derivative)/,
    phrases: ["Running the numbers", "Solving step by step", "Checking the arithmetic"],
  },
  {
    match: /(search|find|look up|google|research)/,
    phrases: ["Digging in", "Searching", "Cross-referencing sources"],
  },
  {
    match: /(idea|brainstorm|suggest|recommend)/,
    phrases: ["Brainstorming", "Kicking around options", "Turning over angles"],
  },
  {
    match: /(chart|graph|plot|visuali[sz]e|data)/,
    phrases: ["Charting it out", "Shaping the data", "Picking the right view"],
  },
  {
    match: /(fix|debug|why (isn'?t|doesn'?t|won'?t))/,
    phrases: ["Tracing the issue", "Narrowing it down", "Reproducing this"],
  },
  {
    match: /(location|where am i|near me|weather)/,
    phrases: ["Checking nearby", "Getting the local view"],
  },
  { match: /(joke|funny|laugh)/, phrases: ["Working on a good one", "Setting up the punchline"] },
];

function phrasesForPrompt(prompt: string | undefined): string[] {
  const p = (prompt ?? "").toLowerCase();
  const buckets: string[] = [];
  for (const b of PROMPT_BUCKETS) if (b.match.test(p)) buckets.push(...b.phrases);
  if (buckets.length === 0) return GENERIC_PHRASES;
  return [...buckets, ...GENERIC_PHRASES.slice(0, 10)];
}

function deriveStatus(
  message: Message | undefined,
  streaming: boolean,
  lastUserPrompt: string | undefined,
  tick: number,
): string | null {
  if (!streaming) return null;
  const acts = message?.activities;
  const last = acts && acts.length > 0 ? acts[acts.length - 1] : undefined;
  if (last) {
    const fromTool = toolToLabel(last.tool);
    const label = (last.label && last.label.trim()) || fromTool || "Working";
    return label.replace(/[.…]+$/, "");
  }
  if (message?.content && message.content.trim().length > 0) {
    return message.content.length < 220 ? "Writing draft" : "Finalizing response";
  }
  const pool = phrasesForPrompt(lastUserPrompt);
  return pool[tick % pool.length];
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2200);
    return () => window.clearInterval(id);
  }, [streaming]);
  const status = deriveStatus(message, streaming, lastUserPrompt, tick);
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
