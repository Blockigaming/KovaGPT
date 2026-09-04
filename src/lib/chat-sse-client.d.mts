export type ChatSseEvent = Record<string, unknown>;

export class ChatStreamError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly category: string;
  readonly requestId?: string;
  constructor(
    code: string,
    message: string,
    options?: {
      status?: number;
      retryable?: boolean;
      category?: string;
      requestId?: string;
    },
  );
}

export function consumeChatSse(
  stream: ReadableStream<Uint8Array>,
  options?: {
    signal?: AbortSignal;
    onEvent?: (event: ChatSseEvent) => void | Promise<void>;
    maxBufferChars?: number;
    idleTimeoutMs?: number;
  },
): Promise<void>;

export type ChatRequestError = Error & {
  name: "ChatRequestError";
  status: number;
  code: string;
  category?: string;
  requestId?: string;
  retryable: boolean;
  retryAfter?: number;
};

export function chatResponseError(
  response: Response,
  fallbackMessage?: string,
): Promise<ChatRequestError>;
