export const CHAT_BODY_LIMIT_BYTES: number;
export const CHAT_MAX_MESSAGES: number;
export const CHAT_MAX_MESSAGE_CHARS: number;
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE: number;
export const CHAT_MAX_IMAGE_BYTES: number;
export const CHAT_MAX_TEXT_ATTACHMENT_CHARS: number;
export const CHAT_MAX_ANON_BUCKETS: number;

export type ChatModeId =
  | "instant"
  | "medium"
  | "thinking"
  | "high"
  | "extra_high"
  | "pro"
  | "kova_5_5"
  | "kova_5_4"
  | "kova_o3";
export type ChatClientTool =
  "web_search" | "deep_research" | "image" | "study" | "data_analysis" | "file_analysis";

export type ChatUserContext = {
  name?: string;
  pronouns?: string;
  email?: string;
  phone?: string;
  address?: string;
  extraFacts?: string;
  customInstructions?: string;
  mood?: string;
  responseLength?: "short" | "medium" | "long";
  language?: string;
  rememberAcross?: boolean;
  webSearch?: boolean;
};

export type ChatAttachment =
  | { kind: "image"; dataUrl: string }
  | {
      kind: "text_file";
      name: string;
      content: string;
      fileType?: string;
      size?: number;
    }
  | {
      kind: "library_file";
      libraryItemId: string;
      name: string;
      fileType?: string;
      size?: number;
      sourceProject?: string;
    };

export type NormalizedChatPayload = {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    attachments?: ChatAttachment[];
  }>;
  mode?: ChatModeId;
  user?: ChatUserContext;
  timezone?: string;
  locale?: string;
  chatId?: string;
  memoryStartIndex?: number;
  historyOffset?: number;
  summaryProof?: { id: string; start: number; count: number; digest: string };
  personality?: string;
  projectId?: string;
  temporary?: boolean;
  temporaryContext?: "clean" | "personalized";
  clientTool?: ChatClientTool;
};

export class ChatIngressError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  constructor(code: string, status: number, publicMessage: string);
}

export function normalizeChatPayload(value: unknown): NormalizedChatPayload;
export function readChatRequest(
  request: Request,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<NormalizedChatPayload>;
export function toChatIngressErrorEnvelope(
  error: ChatIngressError,
  requestId: string,
  timestamp?: string,
): {
  error: string;
  code: string;
  category: "bad_request";
  requestId: string;
  retryable: false;
  timestamp: string;
};

export function normalizeIpAddress(value: unknown): string | null;
export function resolveAnonymousClientKey(headers: Headers): string;
export function createAnonymousRateLimiter(options?: {
  maxRequests?: number;
  windowMs?: number;
  maxBuckets?: number;
}): {
  isLimited(key: string, now?: number): boolean;
  size(): number;
  clear(): void;
};
export const chatAnonymousRateLimiter: ReturnType<typeof createAnonymousRateLimiter>;
