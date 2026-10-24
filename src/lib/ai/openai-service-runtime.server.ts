import { runtimeEnv } from "@/lib/runtime-env.server";
import { modelForPolicy } from "@/lib/ai/model-catalog.server";
import {
  createOpenAiServiceClient,
  createOpenAiServices,
  OpenAiServiceError,
} from "./openai-services.server.mjs";

export function openAiServices(
  model = modelForPolicy("normal").id,
  options: { maxOutputTokens?: number; instructions?: string } = {},
) {
  if (runtimeEnv("KOVA_GENERATION_DISABLED") === "true")
    throw new OpenAiServiceError("generation_disabled", 503);
  for (const name of ["KOVA_REQUEST_CAPTURE_ENABLED", "KOVA_GENERATION_ACCEPTANCE_ENABLED"]) {
    const mode = runtimeEnv(name);
    if (mode && mode !== "false") throw new OpenAiServiceError("operator_mode_active", 503);
  }
  return createOpenAiServices({
    client: createOpenAiServiceClient(runtimeEnv("OPENAI_API_KEY")),
    model,
    agentModel: modelForPolicy("deep").id,
    browserDomains: (() => {
      try {
        return JSON.parse(runtimeEnv("KOVA_OPENAI_BROWSER_ALLOWED_DOMAINS_JSON") || "[]");
      } catch {
        return [];
      }
    })(),
    ...options,
    reportCleanupFailure: (resources) =>
      console.error("[openai-services] resource cleanup needs reconciliation", { resources }),
  });
}
