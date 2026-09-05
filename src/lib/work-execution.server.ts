import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import { assertNotBanned } from "@/lib/api-auth.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { getAgentEntitlement, AGENT_LIMITS } from "@/agents/execution.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import { activeModelConfig } from "@/lib/ai/model-router.server";
import { OPENAI_TEXT_MODELS } from "@/lib/ai/model-catalog.server";
import {
  workModelOptions,
  selectWorkModel,
  assertWorkRunnerModel,
} from "@/lib/work-model-policy.mjs";
import { registeredWorkRunner, configuredWorkRunnerTransport } from "@/lib/work-runner.server";
import {
  admitWorkRun,
  parseWorkSubmission,
  runnerReady,
  transitionWorkRun,
  workInputHash,
  workUuid,
  type WorkRun,
} from "@/lib/work-execution-protocol.mjs";

const database = (caller: AuthedCaller) => workExecutionDatabase(caller.supabaseAdmin);
export async function workExecutionReadiness(caller: AuthedCaller) {
  const runner = await registeredWorkRunner();
  const tier = await getAgentEntitlement(caller);
  let permitted = getAiRuntimeConfig().generationEnabled;
  try {
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  } catch {
    permitted = false;
  }
  const options = workModelOptions({
    capabilities: runnerReady(runner) ? (runner?.modelCapabilities ?? []) : [],
    models: OPENAI_TEXT_MODELS,
    roles: activeModelConfig(),
    plan: tier,
  });
  const available = permitted && runnerReady(runner) && options.some((item) => item.available);
  return {
    available,
    reason: available
      ? null
      : "Work execution is unavailable for this account or provider configuration. You can prepare and save work.",
    modelOptions: options.map((item) =>
      permitted
        ? item
        : { ...item, available: false, reason: "Execution is currently unavailable." },
    ),
  };
}
function authorizeModelChoice(run: WorkRun) {
  if (!run.modelSelection) return;
  const selection = run.modelSelection;
  const options = workModelOptions({
    capabilities: [
      {
        model: run.model,
        reasoningEfforts: selection.reasoningEffort ? [selection.reasoningEffort] : [],
        maxOutputTokens: selection.maxOutputTokens,
      },
    ],
    models: OPENAI_TEXT_MODELS,
    roles: activeModelConfig(),
    plan: run.plan,
  });
  const current = selectWorkModel(selection, options);
  if (
    current.model !== run.model ||
    current.premium !== run.premium ||
    current.selection.maxOutputTokens !== selection.maxOutputTokens
  )
    throw new Error("work_model_choice_unavailable");
}
export async function getWorkExecution(caller: AuthedCaller, id: string): Promise<WorkRun> {
  const { data, error } = await database(caller)
    .from("work_execution_runs")
    .select("state")
    .eq("id", workUuid(id))
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (error) throw new Error("work_storage_unavailable");
  if (!data) throw new Error("work_run_not_found");
  return data.state as WorkRun;
}
export async function listWorkExecutions(caller: AuthedCaller, before?: string) {
  let query = database(caller)
    .from("work_execution_runs")
    .select("id,state,created_at")
    .eq("owner_id", caller.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(21);
  if (before) {
    const [at, id, extra] = before.split("|");
    if (
      !at ||
      !id ||
      extra !== undefined ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(at) ||
      !Number.isFinite(Date.parse(at))
    )
      throw new Error("work_cursor_invalid");
    workUuid(id);
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("work_storage_unavailable");
  const rows = data ?? [];
  const page = rows.slice(0, 20);
  const last = page.at(-1);
  return {
    runs: page.map((row) => row.state as WorkRun),
    nextCursor: rows.length > 20 && last ? `${last.created_at}|${last.id}` : null,
  };
}

/** Concrete repository for the configured adapter, never constructed from a browser payload. */
export function createWorkExecutionRepository(caller: AuthedCaller) {
  async function authorize(run: WorkRun) {
    if (run.ownerId !== caller.userId) throw new Error("work_owner_required");
    if (await assertNotBanned(caller)) throw new Error("work_admission_denied");
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
    const tier = await getAgentEntitlement(caller);
    if (!tier || tier !== run.plan || !getAiRuntimeConfig().generationEnabled)
      throw new Error("work_admission_denied");
    authorizeModelChoice(run);
  }
  return {
    load: (runId: string) => getWorkExecution(caller, runId),
    authorize,
    async assertLease(run: WorkRun) {
      await authorize(run);
      const { data, error } = await database(caller).rpc("assert_work_execution_lease", {
        p_owner_id: caller.userId,
        p_run_id: run.id,
        p_epoch: run.epoch,
        p_runner_id: run.runnerId,
      });
      if (error || data !== true) throw new Error("work_lease_stale");
    },
    async commit(run: WorkRun, expectedRevision: number, mutationId: string) {
      if (run.ownerId !== caller.userId) throw new Error("work_owner_required");
      const mutationHash = await workInputHash({
        runId: run.id,
        expectedRevision,
        event: run.event,
        epoch: run.epoch,
      });
      return (await committed(caller, run, mutationId, mutationHash, expectedRevision)).state;
    },
  };
}
async function committed(
  caller: AuthedCaller,
  run: WorkRun,
  mutationId: string,
  mutationHash: string,
  expectedRevision: number,
  readyUntil?: number,
  concurrency = 1,
) {
  const { data, error } = await database(caller).rpc("commit_work_execution", {
    p_owner_id: caller.userId,
    p_run_id: run.id,
    p_mutation_id: mutationId,
    p_mutation_hash: mutationHash,
    p_expected_revision: expectedRevision,
    p_state: run,
    p_runner_ready_until: readyUntil ? new Date(readyUntil).toISOString() : null,
    p_concurrency: concurrency,
  });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "work_revision_conflict"
        : error.code === "42501"
          ? "work_access_denied"
          : "work_storage_unavailable",
    );
  return data as { state: WorkRun; idempotent: boolean; appliedRevision: number };
}
export async function submitWorkExecution(caller: AuthedCaller, body: unknown) {
  const input = parseWorkSubmission(body);
  const db = database(caller);
  // Return the exact original admission on a network retry, even if the runner
  // is now offline. A changed request must never reuse its mutation identifier.
  const previous = await db
    .from("work_execution_runs")
    .select("state,request_hash")
    .eq("owner_id", caller.userId)
    .eq("request_id", input.mutationId)
    .maybeSingle();
  if (previous.error) throw new Error("work_storage_unavailable");
  const requestHash = await workInputHash(input);
  if (previous.data) {
    if (previous.data.request_hash !== requestHash) throw new Error("work_idempotency_conflict");
    return { state: previous.data.state as WorkRun, idempotent: true };
  }
  let sessionContext: Record<string, unknown> | null = null;
  if (input.sessionId) {
    const session = await db
      .from("work_saved_records")
      .select("payload,revision,kind,deleted_at")
      .eq("owner_id", caller.userId)
      .eq("id", input.sessionId)
      .maybeSingle();
    if (
      session.error ||
      !session.data ||
      session.data.kind !== "session" ||
      session.data.deleted_at ||
      session.data.revision !== input.sessionRevision
    )
      throw new Error("work_session_conflict");
    sessionContext = {
      objective: session.data.payload.objective,
      context: session.data.payload.context,
      steps: session.data.payload.steps,
    };
  }
  const runner = await registeredWorkRunner();
  if (!runnerReady(runner)) throw new Error("work_runner_unavailable");
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  const tier = await getAgentEntitlement(caller);
  if (tier !== "plus" && tier !== "pro") throw new Error("work_entitlement_required");
  const config = getAiRuntimeConfig();
  if (!config.generationEnabled) throw new Error("work_generation_unavailable");
  const decision = selectWorkModel(
    input,
    workModelOptions({
      capabilities: runner!.modelCapabilities ?? [],
      models: OPENAI_TEXT_MODELS,
      roles: activeModelConfig(),
      plan: tier,
    }),
  );
  const run = await admitWorkRun(
    input,
    {
      sessionContext,
      runId: crypto.randomUUID(),
      ownerId: caller.userId,
      accountActive: true,
      lockdownAllowed: true,
      costAllowed: config.generationEnabled,
      plan: tier,
      model: decision.model,
      modelSelection: decision.selection,
      premium: decision.premium,
      maxActions: AGENT_LIMITS[tier].maxActions,
      maxTokens: Math.min(config.maxTokensPerUserDay, config.maxTokensPerUserMonth, 500000),
      maxCostMicros: Math.floor(config.maxCostUsdPerRequest * 1_000_000),
      runtimeMs: AGENT_LIMITS[tier].maxRuntimeMs,
    },
    runner,
  );
  const saved = await committed(
    caller,
    run,
    input.mutationId,
    requestHash,
    0,
    runner!.expiresAt,
    Math.min(AGENT_LIMITS[tier].concurrency, config.maxConcurrentPerUser),
  );
  // The configured durable dispatcher retries callback delivery and polls the
  // protected drain endpoint. An ambiguous wake-up never repeats admission.
  let dispatchConfirmed = false;
  try {
    const transport = configuredWorkRunnerTransport();
    if (transport) {
      await transport.dispatch({
        runId: saved.state.id,
        ownerId: caller.userId,
        requestHash: saved.state.requestHash,
      });
      dispatchConfirmed = true;
    }
  } catch {
    /* Preserve the durable queued request for dispatcher recovery. */
  }
  return { ...saved, dispatchConfirmed };
}
export async function controlWorkExecution(caller: AuthedCaller, body: Record<string, unknown>) {
  const runId = workUuid(body.runId);
  const mutationId = workUuid(body.mutationId);
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1)
    throw new Error("work_revision_invalid");
  const command = body.command;
  if (!command || typeof command !== "object" || Array.isArray(command))
    throw new Error("work_command_invalid");
  const action = command as Record<string, unknown>;
  if (
    ![
      "cancel",
      "pause",
      "direction",
      "edit_direction",
      "remove_direction",
      "answer",
      "approve",
      "deny",
      "resume",
    ].includes(String(action.type))
  )
    throw new Error("work_command_invalid");
  const hash = await workInputHash({ runId, expectedRevision: body.expectedRevision, command });
  const receipt = await database(caller)
    .from("work_execution_receipts")
    .select("mutation_hash,run_id")
    .eq("owner_id", caller.userId)
    .eq("mutation_id", mutationId)
    .maybeSingle();
  if (receipt.error) throw new Error("work_storage_unavailable");
  if (receipt.data) {
    if (receipt.data.mutation_hash !== hash || receipt.data.run_id !== runId)
      throw new Error("work_idempotency_conflict");
    return { state: await getWorkExecution(caller, runId), idempotent: true };
  }
  const previous = await getWorkExecution(caller, runId);
  if (action.type === "resume" || action.type === "approve") {
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
    if (!(await getAgentEntitlement(caller))) throw new Error("work_entitlement_required");
  }
  const currentRunner = action.type === "resume" ? await registeredWorkRunner() : null;
  if (action.type === "resume") {
    await createWorkExecutionRepository(caller).authorize(previous);
    if (!runnerReady(currentRunner)) throw new Error("work_runner_unavailable");
    assertWorkRunnerModel(previous, currentRunner!);
  }
  const run = await transitionWorkRun(previous, action, {
    actor: "owner",
    ownerId: caller.userId,
    expectedRevision: body.expectedRevision,
    runner: currentRunner,
  });
  return committed(caller, run, mutationId, hash, Number(body.expectedRevision));
}
