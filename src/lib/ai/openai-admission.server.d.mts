import type { DistributedRateLimitResult } from "../distributed-rate-limit.mjs";

export function consumeOpenAiAdmission(options: {
  identity: string;
  action: string;
  limit: number;
  windowSeconds: number;
  backendUrl?: string;
  serviceRoleKey?: string;
  hashSecret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<DistributedRateLimitResult>;
