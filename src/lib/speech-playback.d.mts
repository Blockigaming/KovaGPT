export type SpeechState = "idle" | "loading" | "playing" | "error";
export type SpeechInput = {
  ownerId: string;
  chatId: string;
  messageId: string;
  contentSha256: string;
};
export function createBrowserSpeechSink(options: {
  signal: AbortSignal;
  onPlaying: () => void;
  onEnded: () => void;
  onError: () => void;
}): { write(bytes: Uint8Array): Promise<void>; end(): Promise<void>; dispose(): void };
export function createSpeechPlayback(options: {
  fetchImpl?: typeof fetch;
  createSink?: typeof createBrowserSpeechSink;
  onState: (state: SpeechState, code?: string) => void;
}): { start(input: SpeechInput): Promise<void>; stop(): void };
