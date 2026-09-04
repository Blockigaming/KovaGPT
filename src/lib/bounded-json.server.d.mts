export const DEFAULT_JSON_BODY_LIMIT: number;

export class BoundedJsonError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number);
}

export function readBoundedUtf8(
  request: Request,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<string>;

export function readBoundedJsonObject(
  request: Request,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>>;
