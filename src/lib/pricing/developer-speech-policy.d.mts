export const SPEECH_MODEL: string;
export const SPEECH_MAX_CHARACTERS: number;
export const SPEECH_MAX_AUDIO_BYTES: number;
export function developerSpeechFields(input: unknown): {
  input: string;
  voice: string;
  response_format: string;
};
export function bindDeveloperSpeechVoice(
  body: Record<string, unknown>,
  approvedVoice?: string,
): Record<string, unknown>;
export function validDeveloperSpeechRequest(body: unknown): boolean;
export function developerSpeechReceipt(value: unknown): { speech_character_credits: number } | null;
export function runDeveloperSpeech(
  body: Record<string, unknown>,
  options: {
    apiKey?: string;
    approvedVoice?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<Response>;
