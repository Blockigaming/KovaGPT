export const MEMORY_LIMITS: Readonly<{
  maxBodyBytes: number;
  maxMessages: number;
  maxContentChars: number;
  maxChatIdChars: number;
  maxTitleChars: number;
}>;

export class DurableBackendError extends Error {
  operation: string;
  constructor(operation: string);
}

export class BodyReadError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string);
}

export function readUtf8BodyBounded(request: Request, maxBytes: number): Promise<string>;

export function readResponseBytesBounded(
  response: Pick<Response, "headers" | "body">,
  maxBytes: number,
): Promise<Uint8Array>;

export function assertDatabaseSuccess<T>(
  result: { data: T; error?: unknown } | null | undefined,
  operation: string,
): T;

export type MemoryPayload = {
  chatId: string;
  title: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

export function parseMemoryPayload(
  raw: string,
): { ok: true; value: MemoryPayload } | { ok: false; status: number; error: string };

export function persistMemorySafely(options: {
  upsert: () => Promise<{ data: unknown; error?: unknown }>;
  listOverflow?: (() => Promise<{ data: unknown[] | null; error?: unknown }>) | null;
  deleteOverflow: (rows: unknown[]) => Promise<{ data: unknown; error?: unknown }>;
}): Promise<void>;

export function suppressThenConsumeToken(options: {
  alreadyUsed: boolean;
  suppress: () => Promise<{ data: unknown; error?: unknown }>;
  consume: () => Promise<{ data: unknown; error?: unknown }>;
}): Promise<void>;

export function unsubscribeLinkState(options: {
  alreadyUsed: boolean;
  suppressionResult: { data: unknown; error?: unknown };
}): { valid: boolean; reason?: "already_unsubscribed" };

export function retryableUnavailable(error: string): Response;
export function noStoreJson(body: unknown, init?: ResponseInit): Response;
export function financeQueueUnavailableResponse(): Response;
