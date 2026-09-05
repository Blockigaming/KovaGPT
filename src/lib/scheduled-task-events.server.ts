import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  currentTaskConnectionToken,
  assertTaskConnectionCurrent,
  type TaskConnectionGrant,
} from "@/lib/scheduled-task-connected.server";
import { createTaskEventRuntime } from "@/lib/task-event-runtime.server.mjs";
import { verifyTaskProviderEvent } from "@/lib/task-event-verification.server.mjs";

type Query = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): Query;
  abortSignal(signal: AbortSignal): Query;
};
const admin = supabaseAdmin as unknown as {
  rpc(name: string, args: Record<string, unknown>): Query;
  from(table: string): Query;
};
type Provider = "gmail" | "slack" | "github";
const providers: Provider[] = ["gmail", "slack", "github"];
export function taskEventConfiguration() {
  const env = process.env;
  const config = {
    slackSecret: env.TASK_SLACK_SIGNING_SECRET,
    slackAppId: env.TASK_SLACK_APP_ID,
    githubSecret: env.TASK_GITHUB_WEBHOOK_SECRET,
    gmailAudience: env.TASK_GMAIL_PUSH_AUDIENCE,
    gmailServiceAccount: env.TASK_GMAIL_PUSH_SERVICE_ACCOUNT,
    gmailSubscription: env.TASK_GMAIL_PUSH_SUBSCRIPTION,
    gmailTopic: env.TASK_GMAIL_TOPIC,
  };
  let gmailAudience = false;
  try {
    const url = new URL(config.gmailAudience ?? "");
    gmailAudience =
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      url.pathname === "/api/tasks/events/gmail";
  } catch {
    /* Disabled until a canonical callback is configured. */
  }
  const active = env.TASK_EVENT_INGRESS_ENABLED === "true";
  const configured = {
    slack:
      active &&
      Boolean(
        config.slackSecret &&
        config.slackSecret.length >= 16 &&
        /^A[A-Z0-9]{8,30}$/u.test(config.slackAppId ?? ""),
      ),
    github: active && Boolean(config.githubSecret && config.githubSecret.length >= 16),
    gmail:
      active &&
      gmailAudience &&
      Boolean(
        /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/u.test(
          config.gmailServiceAccount ?? "",
        ) &&
        /^projects\/[A-Za-z0-9-]+\/subscriptions\/[A-Za-z0-9._~-]+$/u.test(
          config.gmailSubscription ?? "",
        ),
      ),
  };
  return { config, configured };
}
async function configurationId(provider: Provider) {
  const { config } = taskEventConfiguration();
  const value =
    provider === "slack"
      ? [config.slackSecret, config.slackAppId]
      : provider === "github"
        ? [config.githubSecret]
        : [
            config.gmailAudience,
            config.gmailServiceAccount,
            config.gmailSubscription,
            config.gmailTopic,
          ];
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function taskEventRpc(
  operation: string,
  data: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<unknown> {
  const result = await admin
    .rpc("scheduled_task_event_ingress_rpc", { p_operation: operation, p_data: data })
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (result.error) {
    const known = [
      "task_connection_unavailable",
      "task_source_conflict",
      "task_source_unavailable",
      "task_plan_required",
      "task_events_unavailable",
      "task_ingress_lease_lost",
      "task_ingress_capacity",
    ];
    throw new Error(
      known.find((code) => result.error?.message?.includes(code)) ??
        "task_event_storage_unavailable",
    );
  }
  return result.data;
}
function runtime() {
  return createTaskEventRuntime({
    rpc: taskEventRpc,
    getToken: currentTaskConnectionToken,
    checkCurrent: assertTaskConnectionCurrent,
    admit: async (grantId, eventKey, event) => {
      const result = await admin
        .rpc("admit_scheduled_task_event", {
          p_grant_id: grantId,
          p_event_key: eventKey,
          p_event: event,
        })
        .abortSignal(AbortSignal.timeout(2000));
      if (result.error)
        throw new Error(
          result.error.message?.includes("task_connection_unavailable")
            ? "task_connection_unavailable"
            : "task_event_admission_unavailable",
        );
      return result.data;
    },
  });
}
export async function receiveTaskProviderEvent(provider: string, request: Request) {
  if (!providers.includes(provider as Provider))
    return Response.json({ error: "Not found" }, { status: 404 });
  const current = provider as Provider,
    { config, configured } = taskEventConfiguration();
  if (!configured[current])
    return Response.json({ error: "Task event intake is not enabled." }, { status: 503 });
  const deadline = Date.now() + (current === "slack" ? 2500 : 9000);
  try {
    const verified = await verifyTaskProviderEvent(current, request, config),
      configId = await configurationId(current);
    if ("challenge" in verified || "ignored" in verified) {
      await taskEventRpc(
        "config_verified",
        { provider: current, configId },
        Math.max(1, deadline - Date.now()),
      );
      return Response.json(
        "challenge" in verified ? { challenge: verified.challenge } : { accepted: true },
      );
    }
    await taskEventRpc("enqueue", { ...verified, configId }, Math.max(1, deadline - Date.now()));
    return Response.json({ accepted: true });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      [
        "task_event_storage_unavailable",
        "task_ingress_capacity",
        "task_events_unavailable",
      ].includes(error.message);
    return Response.json(
      {
        error: unavailable
          ? "Task event intake is temporarily unavailable."
          : "Invalid provider delivery.",
      },
      { status: unavailable ? 503 : 401 },
    );
  }
}
export async function loadTaskEventGrant(
  userId: string,
  grantId: string,
): Promise<TaskConnectionGrant> {
  const result = await admin
    .from("scheduled_task_connection_grants")
    .select(
      "id,user_id,provider,connection_ref,connection_generation,provider_account_id,required_scopes,expires_at,revoked_at",
    )
    .eq("id", grantId)
    .eq("user_id", userId)
    .maybeSingle()
    .abortSignal(AbortSignal.timeout(2000));
  if (result.error || !result.data) throw new Error("task_connection_unavailable");
  return result.data as TaskConnectionGrant;
}
export async function initializeTaskGmailSource(
  userId: string,
  input: { grantId: string; expectedRevision: number; watch: boolean },
) {
  const { config, configured } = taskEventConfiguration();
  if (!configured.gmail) throw new Error("task_events_unavailable");
  const grant = await loadTaskEventGrant(userId, input.grantId);
  if (grant.provider !== "gmail") throw new Error("task_connection_unavailable");
  return runtime().initialize(
    grant,
    { expectedRevision: input.expectedRevision, watch: input.watch, topic: config.gmailTopic },
    AbortSignal.timeout(15000),
  );
}
export async function pumpScheduledTaskEvents({
  signal,
  limit = 10,
}: {
  signal: AbortSignal;
  limit?: number;
}) {
  const { config, configured } = taskEventConfiguration();
  if (!Object.values(configured).some(Boolean)) return { processed: 0 };
  for (const provider of providers) {
    signal.throwIfAborted();
    if (configured[provider])
      await taskEventRpc("config_heartbeat", {
        provider,
        configId: await configurationId(provider),
      });
  }
  // A persisted, explicit watch consent authorizes renewals, never a read grant alone.
  if (configured.gmail && config.gmailTopic && !signal.aborted) {
    const rows = (await taskEventRpc("watch_candidates", {})) as Array<
      TaskConnectionGrant & { revision: number }
    >;
    for (const grant of rows.slice(0, 1)) {
      if (signal.aborted) break;
      await runtime()
        .renewWatch(grant, { revision: grant.revision }, config.gmailTopic, signal)
        .catch(() => {});
    }
  }
  const result = await runtime().pump({ signal, limit });
  if (!signal.aborted) await taskEventRpc("prune", {});
  return result;
}
