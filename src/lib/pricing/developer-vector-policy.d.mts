export function developerVector(value: unknown): number[];
export function parseDeveloperVectorRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): { operation: string; input: Record<string, unknown> };
