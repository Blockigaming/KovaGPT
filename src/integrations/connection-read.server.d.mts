export type ConnectionReadResult = {
  service: string;
  results: { id: string; title: string; url: string | null; snippet: string }[];
  limited: boolean;
};
export function connectionReadRequest(
  id: string,
  query: string,
  token: string,
  options?: { recordType?: "accounts" | "contacts" | "opportunities"; notionPage?: boolean },
): { url: string; init: RequestInit };
export function readConnection(
  id: string,
  query: string,
  token: string,
  fetchImpl?: typeof fetch,
  options?: { recordType?: "accounts" | "contacts" | "opportunities"; notionPage?: boolean },
): Promise<
  | ConnectionReadResult
  | { service: string; page_id: string; blocks: { type: string; text: string }[]; limited: boolean }
>;
