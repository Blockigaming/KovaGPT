export type ConnectionReadResult = {
  service: string;
  results: { id: string; title: string; url: string | null; snippet: string }[];
  limited: boolean;
};
export function connectionReadRequest(
  id: string,
  query: string,
  token: string,
  options?: { recordType?: "accounts" | "contacts" | "opportunities" },
): { url: string; init: RequestInit };
export function readConnection(
  id: string,
  query: string,
  token: string,
  fetchImpl?: typeof fetch,
  options?: { recordType?: "accounts" | "contacts" | "opportunities" },
): Promise<ConnectionReadResult>;
