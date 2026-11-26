export const ACK_KINDS: Readonly<Record<"search" | "reasoning" | "generic", { id: string; text: string }>>;
export const ACK_DELAYS_MS: Readonly<Record<"search" | "reasoning" | "generic", number>>;
export function ackClipUrl(voiceId: string | undefined, kind: string): string | null;
export function createAcknowledgmentPolicy(options?: {
  delays?: Record<"search" | "reasoning" | "generic", number>;
}): {
  readonly delayMs: number;
  reason(kind: "search" | "reasoning"): void;
  realSpeechStarted(): void;
  due(): "search" | "reasoning" | "generic" | null;
};
export function createAckCache(options?: { fetchImpl?: typeof fetch }): {
  get(voiceId: string, kind: string): Promise<{ bytes: Uint8Array; durationMs: number } | null>;
  warm(voiceId: string): Promise<unknown>;
};
