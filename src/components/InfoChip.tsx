// Small dark-black rounded card used to present short, factual snippets
// like the current time or a location. Auto-applied to short assistant
// responses that look like a time/date/location answer so they feel like
// a first-class widget instead of plain text.
import { Clock, MapPin } from "lucide-react";
import type { ReactNode } from "react";

type ChipKind = "time" | "location";

// Very lightweight detector. Only trips on SHORT responses so essays and
// long explanations still render as normal markdown / LongResponseCard.
export function detectInfoChip(text: string): ChipKind | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length > 320) return null;
  const lower = trimmed.toLowerCase();

  const timeRegex = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  const dateWords = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
  const timeCue = /(current time|the time is|it(?:'s| is)\s+(?:currently\s+)?\d|right now.*\d|today is|it is\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i;
  if (timeRegex.test(trimmed) || timeCue.test(lower) || (dateWords.test(trimmed) && /\d/.test(trimmed))) {
    return "time";
  }

  const locationCue = /(you (?:are|'re) (?:in|located)|your location|based on your location|you appear to be in|current location)/i;
  if (locationCue.test(lower)) return "location";

  return null;
}

export function InfoChip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  const Icon = kind === "time" ? Clock : MapPin;
  const label = kind === "time" ? "Time" : "Location";
  return (
    <div className="my-3 rounded-2xl border border-white/5 bg-[#0a0a0a] text-neutral-100 shadow-md overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="px-4 pb-3 pt-1 prose-chat prose-invert max-w-none text-neutral-100 text-[15px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}
