export const REALTIME_SOCKET_PATH: string;
export const REALTIME_SOCKET_PROTOCOL: string;
export function realtimeOrigin(value: unknown): string | null;
export function realtimeGrant(): { id: string; token: string; digest: string };
export function parseRealtimeGrant(value: unknown): { id: string; digest: string };
export function parseRealtimeSessionRequest(
  method: string,
  params: URLSearchParams,
  input: unknown,
): { operation: "issue"; origin: string | null } | { operation: "get" | "close"; id: string };
export function createRealtimeConnection<T>(options: {
  send: (value: Record<string, unknown>) => void;
  close: (code: number, reason: string) => void;
  claim: (
    id: string,
    digest: string,
    connection: string,
  ) => Promise<{ id: string; expiresAt: number }>;
  check: (id: string, connection: string) => Promise<T>;
  quote: (identity: T, input: unknown) => Promise<unknown>;
  begin: (id: string, connection: string, turn: string) => Promise<T>;
  execute: (
    identity: T,
    input: unknown,
    key: string,
    quote: string,
    signal: AbortSignal,
    delta: (value: Record<string, unknown>) => void,
  ) => Promise<unknown>;
  finish: (id: string, connection: string, turn: string) => Promise<unknown>;
  disconnect: (id: string, connection: string) => Promise<unknown>;
}): {
  receive(raw: string): Promise<void>;
  stop(code?: number, reason?: string): Promise<void>;
  heartbeat(): Promise<void>;
  readonly state: string;
};
