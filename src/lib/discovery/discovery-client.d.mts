import type { DiscoveryMode, DiscoveryResult, DiscoveryProduct } from "./discovery-policy.mjs";
export type DiscoveryResponse =
  | { error?: string; enabled?: boolean; operation?: undefined }
  | {
      error?: string;
      operation: "search";
      mode: DiscoveryMode;
      query: string;
      location: string;
      observedAt: string;
      results: DiscoveryResult[];
    }
  | { error?: string; operation: "product"; product: DiscoveryProduct };
export function readDiscoveryResponse(
  response: Response,
  signal: AbortSignal,
): Promise<DiscoveryResponse>;
export function requestDiscovery(options: {
  owner: string;
  body?: unknown;
  signal?: AbortSignal;
  getSession: () => Promise<{
    data: { session: { user: { id: string }; access_token: string } | null };
  }>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ response: Response; data: DiscoveryResponse }>;
