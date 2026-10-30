export type VoiceToolAction = "tts" | "stt" | "sts";
export type VoiceToolsAvailability = {
  configured: boolean;
  tts: boolean;
  stt: boolean;
  sts: boolean;
  voices: { id: string; label: string; available: boolean }[];
  defaultVoiceId: string | null;
};
export function loadVoiceTools(
  ownerId: string,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<VoiceToolsAvailability>;
export function submitVoiceTool(
  input: {
    ownerId: string;
    action: VoiceToolAction;
    text?: string;
    audio?: Blob;
    voiceId?: string;
  },
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ text?: string; audio?: Blob }>;
