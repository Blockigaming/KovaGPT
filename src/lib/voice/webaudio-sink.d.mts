export function supportsStreamingMp3(): boolean;
export function primeVoiceAudio(): void;
export function createWebAudioSegmentSink(options: {
  signal: AbortSignal;
  onPlaying: () => void;
  onEnded: () => void;
  onError: () => void;
  onLevel?: (level: number) => void;
  onProgress?: (elapsed: number, duration: number) => void;
}): {
  write(bytes: Uint8Array): Promise<void>;
  segmentEnd(): Promise<void>;
  end(): Promise<void>;
  dispose(): void;
};
