export const HOSTED_MODEL_MAP: Readonly<Record<string, string>>;
export const FREE_CHAT_FOUNDATION: string;
export function isKovaHostedModelId(value: unknown): value is string;
export function prepareKovaHostedRequest(
  value: unknown,
  options?: { effort?: "none" | "low" | "medium" | "high" | "xhigh" | "max"; freeChat?: boolean },
): {
  endpoint: string;
  body: string;
  alias: string;
  foundation: string;
};
export function requestKovaHostedChat(input?: {
  request: Record<string, unknown>;
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  effort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  freeChat?: boolean;
  beforeRetry?: () => Promise<void>;
}): Promise<Response>;
export const HOSTED_CHAT_URL: "https://api.openai.com/v1/responses";
export const MODEL_OUTPUT_LIMITS: Readonly<Record<string, number>>;
