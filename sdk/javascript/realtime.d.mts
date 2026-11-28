export interface RealtimeSession {
  id: string;
  readonly closed: boolean;
  quote(input: unknown): Promise<unknown>;
  execute(
    input: unknown,
    options: {
      quoteToken: string;
      requestKey: string;
      onEvent?: (event: Record<string, unknown>) => void;
    },
  ): Promise<unknown>;
  cancel(): void;
  close(): void;
}
export function connectRealtimeSession(
  grant: unknown,
  options?: { baseURL?: string; WebSocketImpl?: typeof WebSocket; signal?: AbortSignal },
): Promise<RealtimeSession>;

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; x: number; y: number; button: "left" }
  | { type: "scroll"; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: "wait" | "screenshot" | "finish" };
export interface BrowserSession extends RealtimeSession {
  act(command: {
    snapshot_id: string;
    approved: true;
    source: "browser" | "computer";
    action: BrowserAction;
  }): void;
}
export function connectBrowserSession(
  grant: unknown,
  options?: { baseURL?: string; WebSocketImpl?: typeof WebSocket; signal?: AbortSignal },
): Promise<BrowserSession>;
