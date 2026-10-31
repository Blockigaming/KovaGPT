export type BrowserActivityMetadata = {
  sessionId: string;
  tabCount: number;
  observedAt: number;
  hostname?: string;
  previewPath?: string;
};
export function normalizeBrowserActivity(value: unknown): BrowserActivityMetadata | undefined;
export function browserActivityIsFresh(
  value: BrowserActivityMetadata | undefined,
  now?: number,
): boolean;
