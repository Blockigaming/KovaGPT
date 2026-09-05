import { runtimeEnv } from "@/lib/runtime-env.server";
import { validateAiProviderConfig } from "@/lib/ai/provider.server";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export type ScheduledExecutionReadiness = {
  configured: boolean;
  reason:
    | "ready"
    | "missing_schedule_secret"
    | "generation_disabled"
    | "provider_not_configured"
    | "policy_not_approved"
    | "accounting_not_configured"
    | "scheduler_not_active";
};
export function scheduledExecutionReadiness(): ScheduledExecutionReadiness {
  const secret = runtimeEnv("SCHEDULED_TASK_SECRET") || runtimeEnv("CRON_SECRET");
  if (!secret || secret.length < 32)
    return { configured: false, reason: "missing_schedule_secret" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(runtimeEnv("KOVA_TASK_POLICY_VERSION") ?? ""))
    return { configured: false, reason: "policy_not_approved" };
  if (runtimeEnv("KOVA_GENERATION_DISABLED") === "true")
    return { configured: false, reason: "generation_disabled" };
  try {
    if (validateAiProviderConfig()) return { configured: false, reason: "provider_not_configured" };
  } catch {
    return { configured: false, reason: "provider_not_configured" };
  }
  try {
    getAiRuntimeConfig();
    if (!runtimeEnv("SUPABASE_URL") || !runtimeEnv("SUPABASE_SERVICE_ROLE_KEY")) throw new Error();
  } catch {
    return { configured: false, reason: "accounting_not_configured" };
  }
  return { configured: true, reason: "ready" };
}
type Admin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
};
export async function activeScheduledExecutionReadiness(): Promise<ScheduledExecutionReadiness> {
  const readiness = scheduledExecutionReadiness();
  if (!readiness.configured) return readiness;
  try {
    const result = await (supabaseAdmin as unknown as Admin)
      .rpc("scheduled_task_runtime_ready", {
        p_policy_version: runtimeEnv("KOVA_TASK_POLICY_VERSION"),
      })
      .abortSignal(AbortSignal.timeout(5000));
    if (result.error || result.data !== true)
      return { configured: false, reason: "scheduler_not_active" };
    return readiness;
  } catch {
    return { configured: false, reason: "scheduler_not_active" };
  }
}
