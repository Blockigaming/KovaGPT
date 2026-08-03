import { z } from "zod";
import { runtimeEnv } from "@/lib/runtime-env.server";

const positiveInteger = (fallback: number, maximum: number) =>
  z.coerce.number().int().positive().max(maximum).default(fallback);

const ConfigSchema = z.object({
  generationEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  maxCostUsdPerRequest: z.coerce.number().positive().max(10).default(0.1),
  maxTokensPerUserDay: positiveInteger(50_000, 10_000_000),
  maxTokensPerUserMonth: positiveInteger(500_000, 100_000_000),
  maxPremiumRequestsPeriod: positiveInteger(50, 100_000),
  maxGuestRequestsPerIp: positiveInteger(5, 1_000),
  maxConcurrentGlobal: positiveInteger(10, 10_000),
  maxConcurrentPerUser: positiveInteger(2, 100),
  maxConcurrentPerGuest: positiveInteger(1, 10),
  leaseSeconds: positiveInteger(120, 600),
  ipHashSecret: z.string().min(32).max(512),
});

export type AiRuntimeConfig = z.infer<typeof ConfigSchema>;

let cached: AiRuntimeConfig | undefined;

export function getAiRuntimeConfig(): AiRuntimeConfig {
  if (cached) return cached;
  cached = ConfigSchema.parse({
    generationEnabled: runtimeEnv("AI_GENERATION_ENABLED"),
    maxCostUsdPerRequest: runtimeEnv("KOVA_MAX_COST_USD_PER_REQUEST"),
    maxTokensPerUserDay: runtimeEnv("KOVA_MAX_TOKENS_PER_USER_DAY"),
    maxTokensPerUserMonth: runtimeEnv("KOVA_MAX_TOKENS_PER_USER_MONTH"),
    maxPremiumRequestsPeriod: runtimeEnv("KOVA_MAX_PREMIUM_REQUESTS_PERIOD"),
    maxGuestRequestsPerIp: runtimeEnv("KOVA_MAX_GUEST_REQUESTS_PER_IP"),
    maxConcurrentGlobal: runtimeEnv("KOVA_MAX_CONCURRENT_GLOBAL"),
    maxConcurrentPerUser: runtimeEnv("KOVA_MAX_CONCURRENT_PER_USER"),
    maxConcurrentPerGuest: runtimeEnv("KOVA_MAX_CONCURRENT_PER_GUEST"),
    leaseSeconds: runtimeEnv("KOVA_GENERATION_LEASE_SECONDS"),
    ipHashSecret: runtimeEnv("KOVA_IP_HASH_SECRET"),
  });
  return cached;
}

export function resetAiRuntimeConfigForTests(): void {
  cached = undefined;
}
