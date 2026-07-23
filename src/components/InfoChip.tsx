// Small dark rounded card used to present short, factual snippets like the
// current time or a location. Renders a rich visual widget (analog clock or
// map) plus a Copy button so the user can pull the text into their notes.
import { Clock, MapPin, Copy, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ClockWidget } from "./ClockWidget";
import { MapWidget } from "./MapWidget";

type ChipKind = "time" | "location";

// Narrow detector: only trip on SHORT responses that clearly answer
// "what time is it" or "where am I". News / general answers must NOT match.
export function detectInfoChip(text: string): ChipKind | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length > 220) return null;
  const lower = trimmed.toLowerCase();

  // Reject news / topical content outright.
  if (
    /\b(news|headline|breaking|report|announced|according to|reuters|associated press|study|research shows)\b/i.test(
      lower,
    )
  ) {
    return null;
  }

  // Time: must contain a clock-like time AND a strong time cue.
  const clockTime = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  const timeCue =
    /(current time|the time is|it(?:'s| is)\s+(?:currently\s+|now\s+)?\d{1,2}:\d{2}|right now it(?:'s| is)|local time)/i;
  if (clockTime.test(trimmed) && timeCue.test(lower)) return "time";

  // Location: strong first-person location cue.
  const locationCue =
    /(you (?:are|'re) (?:currently )?(?:in|located in|near)\b|your (?:approximate )?location is|based on your (?:saved |shared )?location|you appear to be in)/i;
  if (locationCue.test(lower)) return "location";

  return null;
}

export function InfoChip({
  kind,
  children,
  rawText,
}: {
  kind: ChipKind;
  children: ReactNode;
  rawText?: string;
}) {
  const Icon = kind === "time" ? Clock : MapPin;
  const label = kind === "time" ? "Time" : "Location";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      const text = rawText ?? (typeof children === "string" ? children : "");
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="my-3 rounded-2xl border border-white/5 bg-[#0a0a0a] text-neutral-100 shadow-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
          <Icon className="w-3.5 h-3.5" />
          <span>{label}</span>
        </div>
        <button
          onClick={copy}
          title={copied ? "Copied" : "Copy"}
          aria-label="Copy"
          className="p-1.5 -mr-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="px-4 pb-4 pt-2 flex items-center gap-4">
        {kind === "time" ? <ClockWidget size={72} /> : null}
        <div className="prose-chat prose-invert max-w-none text-neutral-100 text-[15px] leading-relaxed flex-1 min-w-0">
          {children}
          {kind === "time" && (
            <div className="mt-1 text-[12px] text-neutral-500">
              {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")} ·{" "}
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </div>
          )}
        </div>
      </div>

      {kind === "location" && (
        <div className="px-4 pb-4">
          <MapWidget height={180} />
        </div>
      )}
    </div>
  );
}
