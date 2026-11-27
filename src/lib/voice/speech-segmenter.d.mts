export function speakableText(raw: string): string;
export function createSpeechSegmenter(options?: { maxSegments?: number }): {
  push(delta: string): string[];
  flush(): string[];
};
