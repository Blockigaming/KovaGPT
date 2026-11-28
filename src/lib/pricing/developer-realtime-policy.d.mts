export function withDeveloperRealtimeEvents<T>(
  emit: (event: Record<string, unknown>) => void,
  action: () => T,
): T;
export const REALTIME_MODEL: string;
export const REALTIME_DIMENSIONS: readonly string[];
export function developerRealtimeFields(input: unknown): Record<string, unknown>;
export function validDeveloperRealtimeRequest(body: unknown): boolean;
export function developerRealtimeUsage(value: unknown): Record<string, number> | null;
export function runDeveloperRealtime(
  body: Record<string, unknown>,
  options: {
    apiKey?: string;
    connect: (
      url: string,
      headers: Record<string, string>,
    ) => Pick<
      WebSocket,
      "readyState" | "send" | "close" | "addEventListener" | "removeEventListener"
    >;
    signal?: AbortSignal;
    timeoutMs?: number;
    maximumUsage?: Record<string, number>;
  },
): Promise<Response>;
