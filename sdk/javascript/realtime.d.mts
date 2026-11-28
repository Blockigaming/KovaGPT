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
  quoteComputer(command: {
    snapshot_id: string;
    model: string;
    input: string;
    max_output_tokens: number;
  }): void;
  proposeComputer(command: {
    snapshot_id: string;
    approved: true;
    quote_token: string;
    request_key: string;
  }): void;
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
