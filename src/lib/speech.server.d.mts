import type { HttpAuthedCaller } from "./api-auth.server";
import type { DistributedRateLimitResult } from "./distributed-rate-limit.mjs";
export const SPEECH_LIMITS: { textChars: number; audioBytes: number; timeoutMs: number };
export type SpeechInput = {
  ownerId: string;
  chatId: string;
  messageId: string;
  contentSha256: string;
  voiceId?: string;
};
export type SpeechConfiguration = {
  enabled: boolean;
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
};
export function speechConfiguration(
  env: (name: string) => string | undefined,
  tier: string,
  requestedVoiceId?: string,
): SpeechConfiguration;
export function loadOwnedSpeechMessage(
  auth: HttpAuthedCaller,
  input: SpeechInput,
  signal: AbortSignal,
): Promise<string>;
export function createSpeechHandler(deps: {
  authenticate(request: Request): Promise<HttpAuthedCaller | Response>;
  loadMessage?: typeof loadOwnedSpeechMessage;
  rateLimit(input: {
    identity: string;
    action: string;
    limit: number;
    windowSeconds: number;
  }): Promise<DistributedRateLimitResult>;
  revalidate(auth: HttpAuthedCaller, signal: AbortSignal): Promise<void>;
  config(
    auth: HttpAuthedCaller,
    input: SpeechInput,
  ): SpeechConfiguration | Promise<SpeechConfiguration>;
  fetchImpl?: typeof fetch;
  admit?(input: {
    request: Request;
    ownerId: string;
    chatId: string;
    messageId: string;
    voiceId: string;
    modelId: string;
    text: string;
    signal: AbortSignal;
  }): Promise<{ expiresAt: number } | null>;
}): (request: Request) => Promise<Response>;
