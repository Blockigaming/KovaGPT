export function getWixAccessToken(
  credential: { apiKey: string; clientId: string },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string>;
export function webullSignedHeaders(
  url: URL,
  credential: { apiKey: string; appKey: string; accessToken: string },
  body?: string,
): Record<string, string>;
