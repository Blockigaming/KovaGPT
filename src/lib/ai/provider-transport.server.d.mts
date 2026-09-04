export type ProviderTransportLogDetails = Record<string, string | number | boolean | undefined>;
export type ProviderTransportLog = (
  level: "info" | "warn" | "error",
  event: string,
  details: ProviderTransportLogDetails,
) => void;

export class ProviderTransportTimeoutError extends Error {
  readonly code: "provider_timeout";
  readonly phase: string;
  constructor(phase?: string);
}

export function isProviderTimeoutError(error: unknown): boolean;
export function isAbortError(error: unknown): boolean;

export type RequestDeadline = {
  signal: AbortSignal;
  timeoutMs: number;
  phase: string;
  didTimeout(): boolean;
  didParentAbort(): boolean;
  normalize(error: unknown): unknown;
  cleanup(): void;
};

export function createRequestDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  phase?: string,
): RequestDeadline;

export function waitForPromiseWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  phase?: string,
): Promise<T>;

export type DeadlineOutcome = {
  outcome: "completed" | "cancelled" | "aborted" | "failed" | "timeout";
  status?: number;
  error?: unknown;
};

export function wrapResponseBodyWithDeadline(
  response: Response,
  deadline: RequestDeadline,
  onFinish?: (outcome: DeadlineOutcome) => void,
): Response;

export function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: URL | RequestInfo,
  init: RequestInit,
  deadline: RequestDeadline,
  onFinish?: (outcome: DeadlineOutcome) => void,
): Promise<Response>;

export function createManagedIdentityTokenFetcher(options: {
  env(name: string): string | undefined;
  resource: string;
  fetchImpl?: typeof fetch;
  getTimeoutMs(): number;
  now?: () => number;
  log?: ProviderTransportLog;
  maxResponseBytes?: number;
}): (signal?: AbortSignal) => Promise<string>;
