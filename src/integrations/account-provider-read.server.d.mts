export function getWixAccessToken(
  credential: { apiKey: string; clientId: string },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string>;
