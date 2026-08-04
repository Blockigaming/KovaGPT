export type ChipKind = "time" | "location";

export function detectInfoChip(text: string): ChipKind | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length > 220) return null;
  const lower = trimmed.toLowerCase();
  if (
    /\b(news|headline|breaking|report|announced|according to|reuters|associated press|study|research shows)\b/i.test(
      lower,
    )
  )
    return null;
  const clockTime = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  const timeCue =
    /(current time|the time is|it(?:'s| is)\s+(?:currently\s+|now\s+)?\d{1,2}:\d{2}|right now it(?:'s| is)|local time)/i;
  if (clockTime.test(trimmed) && timeCue.test(lower)) return "time";
  const locationCue =
    /(you (?:are|'re) (?:currently )?(?:in|located in|near)\b|your (?:approximate )?location is|based on your (?:saved |shared )?location|you appear to be in)/i;
  return locationCue.test(lower) ? "location" : null;
}
