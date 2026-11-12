import { principalScopedStorageKey, safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";

export const VOICE_PREFERENCE_KEY = "kova-voice-selection-v1";
export type VoiceChoice = { id: string; label: string; available: boolean };
export function readVoiceChoices(value: unknown): VoiceChoice[] {
  if (!Array.isArray(value) || value.length > 32) return [];
  const choices: VoiceChoice[] = [];
  const ids = new Set<string>();
  for (const choice of value) {
    if (
      !choice ||
      typeof choice !== "object" ||
      typeof choice.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(choice.id) ||
      ids.has(choice.id) ||
      typeof choice.label !== "string" ||
      !choice.label.trim() ||
      choice.label.length > 80 ||
      Array.from(choice.label as string).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      typeof choice.available !== "boolean"
    )
      return [];
    ids.add(choice.id);
    choices.push({ id: choice.id, label: choice.label.trim(), available: choice.available });
  }
  return choices;
}

export function preferredVoice(
  userId: string,
  voices: VoiceChoice[],
  defaultId: string | null,
): string {
  const fallback =
    voices.find((voice) => voice.available && voice.id === defaultId)?.id ??
    voices.find((voice) => voice.available)?.id ??
    "";
  const storage = safeBrowserStorage("localStorage");
  const key = principalScopedStorageKey(VOICE_PREFERENCE_KEY, userId);
  if (!storage || !key) return fallback;
  try {
    const saved = storage.getItem(key);
    if (saved && voices.some((voice) => voice.id === saved && voice.available)) return saved;
    if (saved !== null) storage.removeItem(key);
  } catch {
    // Sandboxed or full storage must not prevent using the server's catalog.
  }
  return fallback;
}

export const VOICE_GLOW_PALETTES = [
  { id: "original", label: "Multicolor", colors: [] },
  { id: "sunset", label: "Sunset", colors: ["#d68f5b", "#cf8796", "#efd7bb"] },
  { id: "ocean", label: "Ocean", colors: ["#789f98", "#8ca8bc", "#a6c7d3"] },
  { id: "lavender", label: "Lavender", colors: ["#a395b3", "#a395b3", "#a395b3"] },
  { id: "white", label: "Soft white", colors: ["#e6e4df", "#e6e4df", "#e6e4df"] },
] as const;

export const VOICE_GLOW_KEY = "kova-voice-glow-v1";

export function preferredVoiceGlow(owner: string | null | undefined) {
  const key = principalScopedStorageKey(VOICE_GLOW_KEY, owner);
  try {
    const saved = key && safeBrowserStorage("localStorage")?.getItem(key);
    return VOICE_GLOW_PALETTES.find(({ id }) => id === saved) ?? VOICE_GLOW_PALETTES[0];
  } catch {
    return VOICE_GLOW_PALETTES[0];
  }
}

export const LIVE_VOICE_REPLY_KEY = "kova-live-voice-reply-v1";
export const LIVE_VOICE_LENGTHS = ["short", "medium", "long"] as const;
type LiveVoiceReply = { length: (typeof LIVE_VOICE_LENGTHS)[number]; details: string };
export const LIVE_VOICE_DETAILS_LIMIT = 1000;

export function readLiveVoiceReply(owner: string | null | undefined): LiveVoiceReply {
  const key = principalScopedStorageKey(LIVE_VOICE_REPLY_KEY, owner);
  try {
    const stored = key && safeBrowserStorage("localStorage")?.getItem(key);
    const value = stored ? JSON.parse(stored) : null;
    return {
      length: LIVE_VOICE_LENGTHS.find((length) => length === value?.length) ?? "short",
      details:
        typeof value?.details === "string" ? value.details.slice(0, LIVE_VOICE_DETAILS_LIMIT) : "",
    };
  } catch {
    return { length: "short", details: "" };
  }
}
