export type ConnectionReadResult = {
  service: string;
  results: { id: string; title: string; url: string | null; snippet: string }[];
  limited: boolean;
};
type ConnectionReadOptions = {
  recordType?: "accounts" | "contacts" | "opportunities";
  calendlyUser?: string;
  beforeRequest?: () => Promise<void>;
};
export function connectionReadRequest(
  id: string,
  query: string,
  token: string,
  options?: ConnectionReadOptions,
): { url: string; init: RequestInit };
export function readConnection(
  id: string,
  query: string,
  token: string,
  fetchImpl?: typeof fetch,
  options?: ConnectionReadOptions,
): Promise<ConnectionReadResult>;
