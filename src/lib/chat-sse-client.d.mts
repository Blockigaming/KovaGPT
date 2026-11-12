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
  usageKind?: "thinking" | "regular";
  resetAtMs?: number;
};

export function chatResponseError(
  response: Response,
  fallbackMessage?: string,
): Promise<ChatRequestError>;

export function chatFailurePresentation(
  error: Pick<
    Partial<ChatRequestError>,
    "category" | "status" | "code" | "retryable" | "requestId"
  >,
  details: { raw: string; signedIn: boolean; quotaRejected: boolean; networkFailure: boolean },
): {
  sessionExpired: boolean;
  canManualRetry: boolean;
  friendly: string;
  detail: string;
  reference?: string;
  preservedDraftMessage: string;
};

export function publishRequestedChatTool(
  tool: string | null | undefined,
  publish: (notice: { id: string; title: string }) => void,
): void;
