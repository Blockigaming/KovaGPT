export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; x: number; y: number; button: "left" }
  | { type: "scroll"; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: "wait" | "screenshot" | "finish" };
export interface BrowserChannel {
  next(view: Record<string, unknown>, remaining: number): Promise<BrowserAction>;
  quoteComputer(
    command: unknown,
    prepare: (
      view: Record<string, unknown>,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<{ input: Record<string, unknown>; quote: unknown }>,
  ): Promise<unknown>;
  proposeComputer(
    command: unknown,
    execute: (
      input: Record<string, unknown>,
      key: string,
      token: string,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ): Promise<unknown>;
  accept(value: unknown, computerAllowed: boolean): void;
  close(): void;
}
export function parseBrowserAction(value: unknown): BrowserAction;
export function createBrowserChannel(
  emit: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): BrowserChannel;
export function withDeveloperBrowserChannel<T>(
  channel: BrowserChannel,
  action: () => Promise<T>,
): Promise<T>;
export function developerBrowserChannel(): BrowserChannel | undefined;
export function executeInteractiveBrowser<T extends Record<string, unknown>>(options: {
  initial: string;
  channel: BrowserChannel;
  check: (url: URL) => Promise<void>;
  capture: (url: URL) => Promise<T>;
  navigate: (url: URL) => Promise<unknown>;
  linkAt: (x: number, y: number) => Promise<string>;
  scroll: (action: Extract<BrowserAction, { type: "scroll" }>) => Promise<void>;
  wait: () => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  deadline: number;
}): Promise<T>;
