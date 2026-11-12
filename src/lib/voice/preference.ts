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
