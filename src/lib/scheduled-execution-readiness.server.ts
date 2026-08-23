import { runtimeEnv } from "@/lib/runtime-env.server";

export type ScheduledExecutionReadiness = {
  configured: boolean;
  reason: "ready" | "missing_schedule_secret" | "generation_disabled" | "provider_not_configured";
};

function truthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function scheduledExecutionReadiness(): ScheduledExecutionReadiness {
  const secret = runtimeEnv("SCHEDULED_TASK_SECRET") || runtimeEnv("CRON_SECRET");

  if (!secret) {
    return {
      configured: false,
      reason: "missing_schedule_secret",
    };
  }

  if (truthy(runtimeEnv("KOVA_GENERATION_DISABLED"))) {
    return {
      configured: false,
      reason: "generation_disabled",
    };
  }

  const hasAzure =
    !!runtimeEnv("AZURE_OPENAI_ENDPOINT") &&
    (!!runtimeEnv("AZURE_OPENAI_API_KEY") ||
      truthy(runtimeEnv("AZURE_OPENAI_USE_MANAGED_IDENTITY")));

  const hasOpenAI = !!runtimeEnv("OPENAI_API_KEY");

  if (!hasAzure && !hasOpenAI) {
    return {
      configured: false,
      reason: "provider_not_configured",
    };
  }

  return {
    configured: true,
    reason: "ready",
  };
}
