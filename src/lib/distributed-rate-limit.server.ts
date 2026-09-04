import { resolveBackendUrl } from "@/lib/backend-url";
import {
  consumeDistributedRateLimit,
  type DistributedRateLimitResult,
} from "@/lib/distributed-rate-limit.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";

export async function consumeApplicationRateLimit(input: {
  identity: string;
  action: string;
  limit: number;
  windowSeconds: number;
}): Promise<DistributedRateLimitResult> {
  return consumeDistributedRateLimit({
    ...input,
    backendUrl: resolveBackendUrl(),
    serviceRoleKey: runtimeEnv("SUPABASE_SERVICE_ROLE_KEY"),
    hashSecret: runtimeEnv("KOVA_IP_HASH_SECRET"),
  });
}
