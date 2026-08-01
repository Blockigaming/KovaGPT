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

export function retryableUnavailable(error: string): Response;
export function financeQueueUnavailableResponse(): Response;
