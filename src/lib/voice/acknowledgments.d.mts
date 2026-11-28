type AckKind = "search" | "reasoning" | "generic";
export const ACK_KINDS: Readonly<Record<AckKind, { id: string; text: string }>>;
export const ACK_VARIANTS: Readonly<Record<AckKind, readonly { id: string; text: string }[]>>;
export const ACK_DELAYS_MS: Readonly<Record<AckKind, number>>;
export function ackClipUrl(voiceId: string | undefined, kind: string, variant?: number): string | null;
export function createAcknowledgmentPolicy(options?: { delays?: Record<AckKind, number> }): {
  readonly delayMs: number;
  reason(kind: "search" | "reasoning"): void;
  realSpeechStarted(): void;
  due(): AckKind | null;
};
export function createAckCache(options?: { fetchImpl?: typeof fetch }): {
  get(voiceId: string, kind: string): Promise<{ bytes: Uint8Array; durationMs: number } | null>;
  warm(voiceId: string): Promise<unknown>;
};
