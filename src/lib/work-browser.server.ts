import type { AuthedCaller } from "@/lib/api-auth.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorkExecutionRepository, getWorkExecution } from "@/lib/work-execution.server";
import { workRunnerConfiguration } from "@/lib/work-runner.server";
import {
  browserRunnerCommand,
  browserRunnerCapabilities,
  type BrowserBinding,
  type BrowserCommand,
} from "@/lib/work-browser-transport.mjs";
import { workUuid } from "@/lib/work-execution-protocol.mjs";
import { parseBrowserOwnerInput } from "@/lib/work-browser-policy.mjs";

type Session = {
  id: string;
  run_id: string;
  owner_id: string;
  sequence: number;
  mode: string;
  expires_at: string;
  operation: string;
};
type BrowserDatabase = {
  public: {
    Tables: {
      work_browser_sessions: { Row: Session; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      admit_work_browser_owner: {
        Args: {
          p_owner: string;
          p_run: string;
          p_session: string;
          p_run_revision: number;
          p_sequence: number;
          p_operation: string;
        };
        Returns: {
          sessionId: string;
          runId: string;
          sequence: number;
          mode: string;
          expiresAt: number;
        };
      };
      finish_work_browser_owner: {
        Args: { p_owner: string; p_run: string; p_session: string; p_sequence: number };
        Returns: boolean;
      };
      authorize_work_browser: {
        Args: {
          p_owner: string;
          p_run: string;
          p_session: string;
          p_runner: string;
          p_build: string;
          p_actor: string;
          p_phase: string;
          p_sequence: number | null;
          p_epoch: number | null;
          p_step: string | null;
          p_hash: string | null;
          p_approval: string | null;
        };
        Returns: { allowed: true; sequence: number; expiresAt: number };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
const database = (caller: AuthedCaller) =>
  caller.supabaseAdmin as unknown as SupabaseClient<BrowserDatabase>;
export async function browserReadiness() {
  const config = workRunnerConfiguration();
  if (!config) return { available: false, origins: [] as string[] };
  let value;
  try {
    value = await browserRunnerCapabilities(config, AbortSignal.timeout(10000));
  } catch {
    return { available: false, origins: [] as string[] };
  }
  if (
    value?.protocol !== "kova-browser-v1" ||
    value.available !== true ||
    value.maxSessionSeconds !== 300 ||
    !Array.isArray(value.origins) ||
    value.origins.length < 1 ||
    value.origins.length > 20
  )
    return { available: false, origins: [] as string[] };
  const origins: string[] = [];
  for (const origin of value.origins) {
    if (typeof origin !== "string") return { available: false, origins: [] as string[] };
    let url;
    try {
      url = new URL(origin);
    } catch {
      return { available: false, origins: [] as string[] };
    }
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
      return { available: false, origins: [] as string[] };
    origins.push(origin);
  }
  return { available: true, origins };
}
export async function listWorkBrowsers(caller: AuthedCaller, runId: string) {
  const run = await getWorkExecution(caller, workUuid(runId));
  const result = await database(caller)
    .from("work_browser_sessions")
    .select("id,run_id,owner_id,sequence,mode,expires_at")
    .eq("owner_id", caller.userId)
    .eq("run_id", run.id)
    .neq("mode", "closed")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw Error("work_browser_unavailable");
  return {
    readiness: await browserReadiness(),
    runRevision: run.revision,
    runStatus: run.status,
    sessions: result.data ?? [],
  };
}
export async function commandWorkBrowser(
  caller: AuthedCaller,
  value: unknown,
  signal: AbortSignal,
) {
  const input = parseBrowserOwnerInput(value);
  if (input.expectedUserId !== caller.userId) throw Error("work_browser_owner_conflict");
  const run = await getWorkExecution(caller, input.runId);
  if (input.operation !== "close") await createWorkExecutionRepository(caller).authorize(run);
  const config = workRunnerConfiguration();
  if (!config || run.runnerId !== config.id || run.runnerBuild !== config.build)
    throw Error("work_browser_unavailable");
  if (input.operation !== "close") {
    const ready = await browserReadiness();
    if (!ready.available) throw Error("work_browser_unavailable");
    if (input.url && !ready.origins.includes(new URL(input.url).origin))
      throw Error("work_browser_origin_denied");
  }
  const db = database(caller),
    deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const admitted = await db
    .rpc("admit_work_browser_owner", {
      p_owner: caller.userId,
      p_run: input.runId,
      p_session: input.sessionId,
      p_run_revision: input.expectedRevision,
      p_sequence: input.expectedSequence,
      p_operation: input.operation,
    })
    .abortSignal(deadline);
  if (admitted.error || !admitted.data)
    throw Error(
      admitted.error?.code === "40001"
        ? "work_browser_revision_conflict"
        : "work_browser_admission_denied",
    );
  const command = { ...input };
  delete (command as Partial<typeof input>).expectedUserId;
  delete (command as Partial<typeof input>).expectedRevision;
  delete (command as Partial<typeof input>).expectedSequence;
  const result = await browserRunnerCommand(
    config,
    {
      ...command,
      actor: "owner",
      ownerId: caller.userId,
      sequence: admitted.data.sequence,
      expiresAt: admitted.data.expiresAt,
    } as BrowserCommand,
    deadline,
  );
  if (
    result?.sessionId !== input.sessionId ||
    result.runId !== input.runId ||
    result.sequence !== admitted.data.sequence
  )
    throw Error("work_browser_unconfirmed");
  const finished = await db
    .rpc("finish_work_browser_owner", {
      p_owner: caller.userId,
      p_run: input.runId,
      p_session: input.sessionId,
      p_sequence: admitted.data.sequence,
    })
    .abortSignal(deadline);
  if (finished.error || finished.data !== true) throw Error("work_browser_unconfirmed");
  return { result, expiresAt: admitted.data.expiresAt };
}
export async function authorizeWorkBrowser(caller: AuthedCaller, binding: BrowserBinding) {
  const run = await getWorkExecution(caller, binding.runId);
  const closing =
    binding.actor === "owner" && binding.phase === "check"
      ? await database(caller)
          .from("work_browser_sessions")
          .select("operation,sequence")
          .eq("id", binding.sessionId)
          .eq("owner_id", caller.userId)
          .eq("run_id", run.id)
          .abortSignal(AbortSignal.timeout(10000))
          .maybeSingle()
      : null;
  if (closing?.error) throw Error("work_browser_unavailable");
  if (closing?.data?.operation !== "close" || closing.data.sequence !== binding.sequence)
    await createWorkExecutionRepository(caller).authorize(run);
  const configuration = workRunnerConfiguration();
  if (!configuration) throw Error("work_browser_unavailable");
  const result = await database(caller)
    .rpc("authorize_work_browser", {
      p_owner: caller.userId,
      p_run: binding.runId,
      p_session: binding.sessionId,
      p_runner: configuration.id,
      p_build: configuration.build,
      p_actor: binding.actor,
      p_phase: binding.phase,
      p_sequence: binding.sequence ?? null,
      p_epoch: binding.epoch ?? null,
      p_step: binding.stepId ?? null,
      p_hash: binding.inputHash ?? null,
      p_approval: binding.approvalId ?? null,
    })
    .abortSignal(AbortSignal.timeout(10000));
  if (result.error || result.data?.allowed !== true) throw Error("work_browser_authority_denied");
  return result.data;
}
