import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  normalizePushSubscription,
  normalizeQuietHours,
  isPushQuiet,
  encodePushKey,
} from "./push-policy.mjs";
import { sealPushSubscription, openPushSubscription } from "./push-vault.server.mjs";
import { sendWebPush, vapidAuthorization } from "./web-push.server.mjs";
type Client = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
};
export async function pushRpc(
  userId: string | null,
  operation: string,
  data: Record<string, unknown> = {},
) {
  const result = await (supabaseAdmin as unknown as Client)
    .rpc("web_push_rpc", { p_user_id: userId, p_operation: operation, p_data: data })
    .abortSignal(AbortSignal.timeout(5000));
  if (result.error) throw new Error("push_operation_unavailable");
  return result.data;
}
export async function pushHash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function pushConfiguration() {
  const publicKey = runtimeEnv("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "",
    privateKey = runtimeEnv("WEB_PUSH_VAPID_PRIVATE_KEY") ?? "",
    subject = runtimeEnv("WEB_PUSH_VAPID_SUBJECT") ?? "",
    vaultSecret = runtimeEnv("CONNECTOR_ENCRYPTION_KEY") ?? "";
  if (runtimeEnv("WEB_PUSH_ENABLED") !== "true" || vaultSecret.length < 16) return null;
  try {
    await vapidAuthorization("https://fcm.googleapis.com/fcm/send/config-validation", {
      publicKey,
      privateKey,
      subject,
    });
  } catch {
    return null;
  }
  return {
    publicKey,
    privateKey,
    subject,
    vaultSecret,
    configId: await pushHash(`${publicKey}:${subject}`),
  };
}
export async function pushStatus(userId: string) {
  const config = await pushConfiguration();
  const value = (await pushRpc(userId, "status", { configId: config?.configId ?? "" })) as Record<
    string,
    unknown
  >;
  return {
    ...value,
    ready: config !== null && value.ready === true,
    publicKey: config?.publicKey ?? null,
  };
}
export async function subscribePush(userId: string, input: unknown) {
  const config = await pushConfiguration();
  if (!config) throw new Error("push_runtime_unavailable");
  const data = normalizePushSubscription(input),
    id = crypto.randomUUID(),
    deviceSecret = encodePushKey(crypto.getRandomValues(new Uint8Array(32)));
  const sealed = await sealPushSubscription(data, userId, id, config.vaultSecret);
  const result = (await pushRpc(userId, "subscribe", {
    id,
    configId: config.configId,
    endpointHash: await pushHash(data.endpoint),
    deviceSecretHash: await pushHash(deviceSecret),
    sealed,
  })) as { id: string; revision: number };
  return { ...result, deviceSecret };
}
export async function setPushQuietHours(
  userId: string,
  expectedRevision: number,
  quietHours: unknown,
) {
  return pushRpc(userId, "preferences", {
    expectedRevision,
    quietHours: normalizeQuietHours(quietHours),
  });
}
export async function revokePushDevice(id: string, deviceSecret: string) {
  return pushRpc(null, "revoke_device", { id, deviceSecretHash: await pushHash(deviceSecret) });
}
type Delivery = {
  id: string;
  userId: string;
  revision: number;
  sealed: string;
  skipped?: boolean;
  eventId: string;
  eventSource: "application" | "agent";
  eventAt: string;
};
type Eligibility = { eligible: boolean; skip?: boolean; quietHours: unknown };
export async function runWebPushBatch(signal: AbortSignal) {
  const config = await pushConfiguration();
  if (!config) throw new Error("push_runtime_unavailable");
  await pushRpc(null, "heartbeat", { configId: config.configId });
  let processed = 0;
  for (let index = 0; index < 3; index++) {
    signal.throwIfAborted();
    const workerId = crypto.randomUUID(),
      row = (await pushRpc(null, "claim", {
        workerId,
        configId: config.configId,
      })) as Delivery | null;
    if (!row) break;
    if (row.skipped) continue;
    const args = { id: row.id, revision: row.revision, workerId, configId: config.configId };
    let outcome: "sent" | "expired" | "retry" | "skip" = "retry";
    const current = async () => {
      const state = (await pushRpc(null, "check", args)) as Eligibility;
      if (!state.eligible) {
        outcome = state.skip ? "skip" : "retry";
        throw new Error("push_not_eligible");
      }
      if (isPushQuiet(state.quietHours)) {
        outcome = "retry";
        throw new Error("push_quiet_hours");
      }
    };
    try {
      await current();
      const decoded = await openPushSubscription(
        row.sealed,
        row.userId,
        row.id,
        config.vaultSecret,
      );
      const subscription = normalizePushSubscription({
        ...(decoded as { endpoint: string }),
        keys: {
          p256dh: (decoded as { p256dh: string }).p256dh,
          auth: (decoded as { auth: string }).auth,
        },
      });
      outcome = await sendWebPush(
        {
          ...subscription,
          id: row.id,
          eventId: row.eventId,
          eventSource: row.eventSource,
          eventAt: row.eventAt,
        },
        config,
        {
          assertCurrent: current,
          signal,
        },
      );
    } catch {
      /* The queue retains transient/quiet-hour failures without exposing private endpoint data. */
    }
    await pushRpc(null, "settle", { ...args, result: outcome }).catch(() => {});
    processed++;
  }
  await pushRpc(null, "prune", {});
  return { processed };
}
