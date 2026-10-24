import type { DistributedRateLimitResult } from "./distributed-rate-limit.mjs";
export function handleDocumentExportDelivery(
  request: Request,
  dependencies: {
    consumeRateLimit: (input: {
      identity: string;
      action: string;
      limit: number;
      windowSeconds: number;
    }) => Promise<DistributedRateLimitResult>;
  },
): Promise<Response>;
