import { runtimeEnv } from "@/lib/runtime-env.server";
import { createManagedIdentityTokenFetcher } from "@/lib/ai/provider-transport.server.mjs";
import { createWorkHostPower, parseWorkHostPowerConfiguration } from "@/lib/work-host-power.mjs";
import { workRunnerConfiguration } from "@/lib/work-runner.server";
import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const getToken = createManagedIdentityTokenFetcher({
  env: runtimeEnv,
  resource: "https://management.azure.com/",
  getTimeoutMs: () => 5000,
});
export function workHostPowerConfigured() {
  return Boolean(parseWorkHostPowerConfiguration(runtimeEnv));
}
let cachedPower: { resourceId: string; client: ReturnType<typeof createWorkHostPower> } | undefined;
export async function wakeWorkHost() {
  const configuration = parseWorkHostPowerConfiguration(runtimeEnv);
  if (!configuration) throw new Error("work_host_power_unavailable");
  if (cachedPower?.resourceId !== configuration.resourceId)
    cachedPower = {
      resourceId: configuration.resourceId,
      client: createWorkHostPower({ ...configuration, getToken }),
    };
  return cachedPower.client.wake();
}

// Conservative read only: any queued/running run or unresolved step prevents
// sleep. Paused plans/questions with no in-flight step can wait while powered off.
export async function workHostHasPendingWork() {
  const runner = workRunnerConfiguration();
  if (!runner) throw new Error("work_runner_unavailable");
  const result = await workExecutionDatabase(supabaseAdmin)
    .from("work_execution_runs")
    .select("status,state")
    .eq("state->>runnerId", runner.id)
    .in("status", ["queued", "running", "paused", "cancelled"])
    .limit(1001);
  if (result.error || !result.data || result.data.length > 1000)
    throw new Error("work_host_queue_unconfirmed");
  return result.data.some(
    ({ status, state }) =>
      ["queued", "running"].includes(status) ||
      state.step != null ||
      (status === "paused" && state.outputRefs.length > 0),
  );
}
export async function recoverSleepingWorkHost() {
  if (!workHostPowerConfigured()) return { status: "disabled" };
  if (!(await workHostHasPendingWork())) return { status: "idle" };
  return { status: await wakeWorkHost() };
}
