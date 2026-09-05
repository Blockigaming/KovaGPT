import type {
  DiscoveryConfig,
  DiscoveryResult,
  DiscoveryProduct,
  DiscoveryMode,
} from "./discovery-policy.mjs";
export function issueDiscoverySource(
  owner: string,
  url: string,
  secret: string,
  now: number,
): string;
export function verifyDiscoverySource(
  token: string,
  owner: string,
  secret: string,
  now: number,
): string;
export function runDiscovery(options: {
  owner: string;
  input: unknown;
  config: DiscoveryConfig;
  admit: () => Promise<boolean>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<
  | { operation: "product"; product: DiscoveryProduct }
  | {
      operation: "search";
      mode: DiscoveryMode;
      query: string;
      location: string;
      observedAt: string;
      results: DiscoveryResult[];
    }
>;
