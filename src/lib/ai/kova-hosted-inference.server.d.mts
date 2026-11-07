export const HOSTED_MODEL_MAP: Readonly<Record<string, string>>;
export function isKovaHostedModelId(value: unknown): value is string;
export function prepareKovaHostedRequest(
  value: unknown,
  options?: { effort?: "none" | "low" | "high" | "max" },
): {
  endpoint: string;
  body: string;
  alias: string;
};
export function requestKovaHostedChat(input?: {
  request: Record<string, unknown>;
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  effort?: "none" | "low" | "high" | "max";
}): Promise<Response>;
export const HOSTED_CHAT_URL: "https://openrouter.ai/api/v1/chat/completions";
export const MODEL_OUTPUT_LIMITS: Readonly<Record<string, number>>;
