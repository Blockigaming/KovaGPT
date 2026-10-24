export type TtsModelId = "eleven_flash_v2_5" | "eleven_multilingual_v2" | "eleven_v4";
export const TTS_MODEL_IDS: readonly TtsModelId[];
export type VoiceCatalogEntry = {
  id: string;
  label: string;
  providerVoiceId: string;
  modelId: TtsModelId;
  allowedPlans: ("free" | "plus" | "pro")[];
  showWhenLocked: boolean;
  available: boolean;
};
export type VoiceCatalog = {
  valid: boolean;
  entries: VoiceCatalogEntry[];
  defaultVoiceId: string | null;
};
export function readVoiceCatalog(
  env: (name: string) => string | undefined,
  tier: string,
): VoiceCatalog;
export function publicVoiceCatalog(
  catalog: VoiceCatalog,
): { id: string; label: string; available: boolean }[];
export function selectCatalogVoice(
  catalog: VoiceCatalog,
  requestedId?: string,
):
  | { error: string; status: number }
  | { providerVoiceId: string; modelId: TtsModelId; catalogId: string };
