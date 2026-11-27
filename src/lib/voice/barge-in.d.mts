export function createBargeInDetector(options?: {
  floor?: number;
  ratio?: number;
  holdMs?: number;
  graceMs?: number;
}): {
  reset(now: number): void;
  feed(input: { mic: number; playback: number; now: number }): boolean;
};
