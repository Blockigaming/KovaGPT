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
