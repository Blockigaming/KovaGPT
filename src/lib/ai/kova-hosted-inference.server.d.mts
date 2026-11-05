export const HOSTED_MODEL_MAP: Readonly<Record<string, string>>;
export function isKovaHostedModelId(value: unknown): value is string;
export function prepareKovaHostedRequest(value: unknown): {
  endpoint: string;
  body: string;
  alias: string;
};
export function requestKovaHostedChat(input?: {
  request: Record<string, unknown>;
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Response>;
