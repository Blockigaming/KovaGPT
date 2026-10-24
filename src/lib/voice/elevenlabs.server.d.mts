import type { VoiceCatalog, TtsModelId } from "./catalog.server.mjs";
export type VoiceConfiguration = {
  apiKey?: string;
  voiceId?: string;
  modelId: TtsModelId;
  catalog: VoiceCatalog;
  dailyLimit: number;
  configured: boolean;
  stt: boolean;
  tts: boolean;
  sts: boolean;
  conversation: boolean;
};
export type VoiceInput = (
  { action: "tts"; text: string } | { action: "stt" | "sts"; audio: Blob }
) & { voiceId?: string };
export const MAX_AUDIO_BYTES: number;
export const MAX_TEXT_CHARACTERS: number;
export class VoiceError extends Error {
  status: number;
  constructor(code: string, status: number);
}
export function voiceConfiguration(
  env: (name: string) => string | undefined,
  tier?: string,
): VoiceConfiguration;
export function publicVoiceConfiguration(config: VoiceConfiguration): {
  voices: { id: string; label: string; available: boolean }[];
  defaultVoiceId: string | null;
  configured: boolean;
  stt: boolean;
  tts: boolean;
  sts: boolean;
  conversation: boolean;
};
export function voiceErrorResponse(error: unknown): Response;
export function parseVoiceRequest(request: Request): Promise<VoiceInput>;
export function executeVoice(
  input: VoiceInput,
  config: VoiceConfiguration,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number },
): Promise<Response>;
