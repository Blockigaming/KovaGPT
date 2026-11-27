import { createHash } from "node:crypto";
import { readAccountIdentity } from "@/lib/account-identity.server.mjs";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  authorizeDeveloperBatchItem,
  developerDatabase,
  developerEnabled,
  developerFailure,
  developerJson,
  executeAuthorizedBatchItem,
  type DeveloperIdentity,
} from "./developer-platform.server";
import {
  assertBatchBudget,
  developerResponseJobView,
  parseDeveloperBatchRequest,
} from "./developer-batch-policy.mjs";

function batchEnabled() {
  return (
    developerEnabled() &&
    runtimeEnv("KOVA_DEVELOPER_BATCH_SCHEMA_READY") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_BATCHES_ENABLED") === "true"
  );
}
async function resource(
  identity: DeveloperIdentity,
  operation: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  const result = await identity.db
    .rpc("manage_developer_batches_v1", {
      p_owner: identity.ownerId,
      p_key: identity.id,
      p_project: identity.project_id,
      p_operation: operation,
      p_input: input,
    })
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
  if (result.error || !result.data) {
    const known = result.error?.message?.match(
      /^developer_(?:batch_not_found|batch_quota_exceeded|batch_conflict|batch_invalid|batch_budget_invalid|scope_required)$/,
    )?.[0];
    throw new Error(known ?? "developer_batch_unavailable");
  }
  return result.data;
}
function automationsEnabled() {
  return batchEnabled() && runtimeEnv("KOVA_DEVELOPER_AUTOMATIONS_ENABLED") === "true";
}
function responseJobsEnabled() {
  return batchEnabled() && runtimeEnv("KOVA_DEVELOPER_BACKGROUND_RESPONSES_ENABLED") === "true";
}
export async function handleDeveloperBatches(
  request: Request,
  resourceKind: "batch" | "automation" | "response" = "batch",
) {
  try {
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes("chat")) throw new Error("developer_scope_required");
    if (
      !batchEnabled() ||
      (resourceKind === "automation" && !automationsEnabled()) ||
      (resourceKind === "response" && !responseJobsEnabled())
    )
      throw new Error("developer_batch_unavailable");
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: resourceKind === "automation" ? "developer_automations" : "developer_batches",
      limit: 10,
      windowSeconds: 60,
    });
    if (!rate.allowed) throw new Error("developer_rate_limit");
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const params = new URL(request.url).searchParams;
    const body =
      request.method === "POST"
        ? await readBoundedJsonObject(request, 65536, request.signal)
        : undefined;
    const parsed = parseDeveloperBatchRequest(
      request.method,
      params,
      body,
      resourceKind,
      Date.now(),
      true,
    );
    const responseJob = async (id: string) =>
      developerResponseJobView(
        await resource(
          identity,
          "get_item",
          { id, item_id: id, resource_kind: "response" },
          request.signal,
        ),
        id,
      );
    if (resourceKind === "response" && parsed.operation === "get")
      return developerJson(await responseJob(parsed.input.id));
    if (resourceKind === "response" && parsed.operation === "cancel") {
      await resource(
        identity,
        "cancel",
        { ...parsed.input, resource_kind: resourceKind },
        request.signal,
      );
      return developerJson(await responseJob(parsed.input.id));
    }
    if (parsed.operation !== "create")
      return developerJson(
        await resource(
          identity,
          parsed.operation,
          { ...parsed.input, resource_kind: resourceKind },
          request.signal,
        ),
      );
    const { id, currency, maximum_ticks, items } = parsed.input;
    const request_digest = createHash("sha256")
      .update(JSON.stringify({ resourceKind, ...parsed.input }))
      .digest("hex");
    // Check an exact existing submission under the same database ownership lock.
    // This lookup cannot create a job or authorize another execution.
    const replay = await resource(
      identity,
      "replay",
      { id, resource_kind: resourceKind, request_digest },
      request.signal,
    );
    if (replay?.found === true) {
      if (!replay.batch || replay.batch.id !== id)
        throw new Error("developer_batch_unavailable");
      return developerJson(resourceKind === "response" ? await responseJob(id) : replay.batch);
    }
    if (replay?.found !== false) throw new Error("developer_batch_unavailable");
    // Only an absent submission can reach new scheduling and quote validation.
    parseDeveloperBatchRequest(request.method, params, body, resourceKind);
    const expiresAt = Date.now() + 86400000;
    // No provider work here: each quote is verified against the current canonical contract.
    const authorized = await Promise.all(
      items.map((item) => authorizeDeveloperBatchItem(identity, id, item, currency, expiresAt)),
    );
    assertBatchBudget(
      maximum_ticks,
      authorized.map((item) => item.maximum_ticks),
    );
    const created = await resource(
      identity,
      "create",
      {
        id,
        resource_kind: resourceKind,
        currency,
        maximum_ticks,
        request_digest,
        expires_at: new Date(expiresAt).toISOString(),
        items: authorized,
      },
      request.signal,
    );
    return developerJson(resourceKind === "response" ? await responseJob(id) : created, 202);
  } catch (error) {
    return developerFailure(error);
  }
}

type Claim = {
  owner_id: string;
  api_key_id: string;
  currency: string;
  item: {
    project_id: string;
    batch_id: string;
    id: string;
    input: Record<string, unknown>;
    authorization: string;
    maximum_ticks: number;
    operation_kind: string;
    run_at: string | null;
    lease_token: string;
  };
};
async function readResult(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("developer_batch_unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "",
    size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 96000) throw new Error("developer_batch_unavailable");
      body += decoder.decode(part.value, { stream: true });
    }
    const value: unknown = JSON.parse(body + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("developer_batch_unavailable");
    return value;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function processDeveloperBatch() {
  if (!batchEnabled()) return 0;
  const db = developerDatabase();
  const claimed = await db
    .rpc("claim_developer_batch_v1", {
      p_allow_automations: automationsEnabled(),
      p_allow_responses: responseJobsEnabled(),
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (claimed.error) throw new Error("developer_batch_unavailable");
  if (!claimed.data) return 0;
  const claim = claimed.data as Claim;
  const item = claim.item;
  let output: object | null = null;
  try {
    const signal = AbortSignal.timeout(30000);
    // Do not persist or reconstruct the user's bearer secret. The worker is
    // authenticated by the existing internal route and rechecks current scope.
    const key = await db
      .from("developer_billing_keys")
      .select("id,account_id,project_id,capabilities")
      .eq("id", claim.api_key_id)
      .eq("project_id", item.project_id)
      .eq("enabled", true)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .abortSignal(signal)
      .maybeSingle();
    if (key.error || !key.data || !key.data.capabilities.includes("chat"))
      throw new Error("developer_scope_required");
    const owner = await db
      .from("developer_account_owners")
      .select("owner_id")
      .eq("account_id", key.data.account_id)
      .eq("owner_id", claim.owner_id)
      .abortSignal(signal)
      .maybeSingle();
    if (owner.error || !owner.data || !(await readAccountIdentity(db, claim.owner_id)))
      throw new Error("developer_scope_required");
    await assertLockdownAllows(db, claim.owner_id, "agent");
    const active = await db
      .rpc("developer_batch_key_active_v1", {
        p_owner: claim.owner_id,
        p_project: item.project_id,
        p_key: claim.api_key_id,
      })
      .abortSignal(signal);
    if (active.error || active.data !== true) throw new Error("developer_scope_required");
    output = await readResult(
      await executeAuthorizedBatchItem(
        { ...key.data, ownerId: claim.owner_id, db },
        item.batch_id,
        item.id,
        item.input,
        item.authorization,
        claim.currency,
        Number(item.maximum_ticks),
        item.operation_kind,
        item.run_at,
        signal,
      ),
    );
  } catch {
    // Never retry automatically after claiming. The accounting record remains
    // authoritative even if the provider result or worker response was lost.
  }
  const finished = await db
    .rpc("finish_developer_batch_v1", {
      p_project: item.project_id,
      p_batch: item.batch_id,
      p_item: item.id,
      p_lease: item.lease_token,
      p_output: output,
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (finished.error || finished.data !== true) throw new Error("developer_batch_unavailable");
  return 1;
}
