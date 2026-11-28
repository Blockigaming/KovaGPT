export const TRANSCRIPTION_MODEL: "gpt-transcribe";
export const TRANSCRIPTION_MAX_SECONDS: 20;
export const TRANSCRIPTION_BODY_LIMIT: 1048576;
export function developerTranscriptionAudio(value: unknown): { bytes: Uint8Array; seconds: number };
export function developerTranscriptionFields(input: unknown): {
  audio: string;
  response_format: "json";
};
export function validDeveloperTranscriptionRequest(body: unknown): boolean;
export function developerTranscriptionReceipt(value: unknown): {
  transcription_seconds: number;
} | null;
export function developerTranscriptionResult(
  value: unknown,
  requestId: string | null,
): {
  id: string;
  model: "gpt-transcribe";
  status: "completed";
  text: string;
  usage: { type: "duration"; seconds: number };
};
