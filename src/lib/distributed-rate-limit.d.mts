export type DistributedRateLimitResult = Readonly<{
  status: "allowed" | "limited" | "unavailable";
  allowed: boolean;
  retryAfter: number;
}>;

export function hashRateLimitIdentity(
  identity: string,
  action: string,
  hashSecret: string,
): Promise<string>;

export function consumeDistributedRateLimit(options: {
  identity: string;
  action: string;
  limit: number;
  windowSeconds: number;
  backendUrl?: string;
  serviceRoleKey?: string;
  hashSecret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DistributedRateLimitResult>;
