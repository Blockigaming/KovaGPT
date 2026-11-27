export function parseDeveloperConversationRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): { operation: string; input: Record<string, unknown> };
