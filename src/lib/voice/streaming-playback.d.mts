import type { VoiceSegmentEvent } from "../composer-voice-turn";
export function createStreamingVoicePlayback(options: {
  ownerId: string;
  voiceId?: string;
  fetchImpl?: typeof fetch;
  createSink: (events: {
    signal: AbortSignal;
    onLevel?: (level: number) => void;
    onPlaying: () => void;
    onEnded: () => void;
    onError: () => void;
  }) => {
    write(bytes: Uint8Array): Promise<void>;
    writePcm?(bytes: Uint8Array): Promise<void>;
    segmentEnd?(): Promise<void>;
    end(): Promise<void>;
    dispose(): void;
  };
  ackCache?: { get(voiceId: string, kind: string): Promise<unknown> };
  tracker?: unknown;
  policy?: unknown;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => number;
  onState?: (state: "loading" | "playing" | "idle" | "error", code?: string) => void;
  onEnded?: () => void;
  onLevel?: (level: number) => void;
}): {
  begin(): void;
  delay(kind: "search" | "reasoning"): void;
  segment(segment: VoiceSegmentEvent): void;
  finish(): boolean;
  stop(): void;
  interrupt(): void;
  readonly active: boolean;
};

export function parseVoiceSegment(
  delta: Record<string, unknown> | undefined,
): VoiceSegmentEvent | null;
export function predictedDelay(mode: string | undefined): "reasoning" | null;
