export class ProviderResponseError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status?: number);
}

export type ProviderResponseSource = Pick<Response, "body" | "headers">;

export function readProviderBytes(
  source: ProviderResponseSource,
  maxBytes: number,
): Promise<Uint8Array>;

export function readProviderText(source: ProviderResponseSource, maxBytes: number): Promise<string>;

export function readProviderJsonObject(
  source: ProviderResponseSource,
  maxBytes: number,
): Promise<Record<string, unknown>>;

export function createBoundedProviderStream(
  source: ProviderResponseSource,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null>;

export function createBoundedProviderSseStream(
  source: ProviderResponseSource,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>>;
