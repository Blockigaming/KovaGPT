import { logOperationalEvent } from "@/lib/structured-log.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { getModelConfig, resolveRoleModel, MODEL_ROLES } from "./model-config.mjs";
import type { ModelRole } from "./model-config.d.mts";
import { routeModel } from "./model-router.mjs";
import type { RouteDecision, RouteInput } from "./model-router.d.mts";

export type { ModelRole, RouteDecision, RouteInput };

function routerEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const role of MODEL_ROLES) {
    const key = (
      {
        DEFAULT_CHAT: "KOVA_MODEL_DEFAULT_CHAT",
        ADVANCED_REASONING: "KOVA_MODEL_ADVANCED_REASONING",
        PREMIUM_REASONING: "KOVA_MODEL_PREMIUM_REASONING",
        UTILITY: "KOVA_MODEL_UTILITY",
        IMAGE_ANALYSIS: "KOVA_MODEL_IMAGE_ANALYSIS",
        IMAGE_GENERATION: "KOVA_MODEL_IMAGE_GENERATION",
        EMBEDDING: "KOVA_MODEL_EMBEDDING",
      } as Record<ModelRole, string>
    )[role];
    env[key] = runtimeEnv(key);
  }
  return env;
}

export function modelForRole(role: ModelRole): string {
  return resolveRoleModel(role, routerEnv()).modelId;
}

export function activeModelConfig(): Record<ModelRole, string> {
  return getModelConfig(routerEnv());
}

/**
 * Server-side model routing. The request body never chooses a model; only the
 * logical role resolved here reaches the provider.
 */
export function routeAiModel(
  input: Omit<RouteInput, "env">,
  context?: { requestId?: string },
): RouteDecision {
  const decision = routeModel({ ...input, env: routerEnv() });
  logOperationalEvent({
    correlationId: context?.requestId ?? "no-request-id",
    category: "ai_routing",
    operation: `route.${input.task}`,
    metadata: {
      role: decision.role,
      model: decision.modelId,
      mode: input.mode ?? "instant",
      tier: input.tier ?? "free",
      complexity: decision.complexityScore,
      maxOutputTokens: decision.maxOutputTokens,
      estimatedCostUsd: decision.estimatedCostUsd,
      reasons: decision.reasons.join("|").slice(0, 180),
      ...(decision.downgradedFrom ? { downgradedFrom: decision.downgradedFrom } : {}),
    },
  });
  return decision;
}
