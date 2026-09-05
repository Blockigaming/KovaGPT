import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
export type PushDeviceBinding = {
  id: string;
  ownerId: string;
  revision: number;
  deviceSecret: string;
};
let registration: Promise<ServiceWorkerRegistration> | null = null,
  activeOwner: string | null = null,
  generation = 0;
let ownerReady: Promise<void> | null = null;
export function registerPwa() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext)
    return Promise.reject(new Error("Install support is unavailable."));
  registration ??= navigator.serviceWorker
    .register("/kova-sw.js", { scope: "/", updateViaCache: "none" })
    .catch((error) => {
      registration = null;
      throw error;
    });
  return registration;
}
function withAbort<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("The request was canceled or timed out."));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
async function workerMessage(
  data: Record<string, unknown>,
  signal?: AbortSignal,
  guard?: () => Promise<void>,
  stillCurrent?: () => boolean,
): Promise<Record<string, unknown>> {
  const deadline = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  const ready = await withAbort(
    registerPwa().then(() => navigator.serviceWorker.ready),
    deadline,
  );
  if (guard) await withAbort(guard(), deadline);
  deadline.throwIfAborted();
  const worker = ready.active;
  if (!worker) throw new Error("The installed app is unavailable.");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const abort = () => {
      channel.port1.close();
      reject(new Error("The installed app did not respond."));
    };
    deadline.addEventListener("abort", abort, { once: true });
    channel.port1.onmessage = (event) => {
      deadline.removeEventListener("abort", abort);
      channel.port1.close();
      if (event.data?.ok === true) resolve(event.data);
      else reject(new Error("Your account or device state changed."));
    };
    if (stillCurrent && !stillCurrent()) {
      deadline.removeEventListener("abort", abort);
      channel.port1.close();
      channel.port2.close();
      reject(new Error("Your account changed."));
      return;
    }
    worker.postMessage(data, [channel.port2]);
  });
}
let ownerEpoch: number | null = null;
async function assertSessionOwner(ownerId: string | null, captured: number) {
  const result = await withAbort(supabase.auth.getSession(), AbortSignal.timeout(10000));
  if (
    result.data.session?.user.id !== (ownerId ?? undefined) ||
    activeOwner !== ownerId ||
    generation !== captured
  )
    throw new Error("Your account changed.");
}
export function setPwaOwner(ownerId: string | null): Promise<void> {
  if (activeOwner === ownerId && ownerReady) return ownerReady;
  activeOwner = ownerId;
  ownerEpoch = null;
  const captured = ++generation;
  const ready = (async () => {
    const state = await workerMessage(
      { type: "STATE" },
      undefined,
      () => assertSessionOwner(ownerId, captured),
      () => generation === captured && activeOwner === ownerId,
    );
    const result = await workerMessage(
      { type: "OWNER", ownerId, expectedEpoch: state.epoch },
      undefined,
      () => assertSessionOwner(ownerId, captured),
      () => generation === captured && activeOwner === ownerId,
    );
    if (generation !== captured) throw new Error("Your account changed.");
    ownerEpoch = result.epoch as number;
  })();
  ownerReady = ready;
  void ready.catch(() => {
    if (ownerReady === ready) ownerReady = null;
  });
  return ready;
}
export async function pwaMessage(
  data: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (["OWNER", "STATE", "CLEAR_OWNER"].includes(String(data.type)))
    throw new Error("Invalid device operation.");
  if (!ownerReady || !data.ownerId || data.ownerId !== activeOwner)
    throw new Error("Your account changed.");
  await withAbort(ownerReady, signal ?? AbortSignal.timeout(15000));
  const captured = generation,
    epoch = ownerEpoch;
  try {
    return await workerMessage(
      { ...data, expectedEpoch: epoch },
      signal,
      () => assertSessionOwner(data.ownerId as string, captured),
      () => generation === captured && activeOwner === data.ownerId && ownerEpoch === epoch,
    );
  } catch (error) {
    if (generation === captured) {
      ownerReady = null;
      ownerEpoch = null;
    }
    throw error;
  }
}
/** The reset coordinator awaits this acknowledgement before claiming erasure. */
export async function clearPwaOwner(ownerId: string | null) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (activeOwner === ownerId) {
    generation++;
    ownerReady = null;
    ownerEpoch = null;
  }
  await workerMessage({ type: "CLEAR_OWNER", ownerId });
}
export async function pushApi(
  ownerId: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
) {
  const epoch = generation;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  deadline.throwIfAborted();
  const session = await withAbort(supabase.auth.getSession(), deadline);
  if (
    deadline.aborted ||
    activeOwner !== ownerId ||
    epoch !== generation ||
    session.data.session?.user.id !== ownerId
  )
    throw new Error("Your account changed.");
  const response = await fetch(
    `/api/push${body ? "" : `?expectedUserId=${encodeURIComponent(ownerId)}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session.data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "omit",
      cache: "no-store",
      signal: deadline,
      ...(body ? { body: JSON.stringify({ ...body, expectedUserId: ownerId }) } : {}),
    },
  );
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readResponseBytesBounded(response, 32000, { signal: deadline, timeoutMs: 5000 }),
    ),
  );
  if (activeOwner !== ownerId || epoch !== generation || deadline.aborted) {
    if (body?.action === "subscribe" && value?.id && value?.deviceSecret)
      void fetch("/api/push/revoke-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ id: value.id, deviceSecret: value.deviceSecret }),
        keepalive: true,
      }).catch(() => {});
    throw new Error("Your account changed.");
  }
  if (!response.ok)
    throw new Error("The notification setting could not be changed. Refresh and try again.");
  return value as Record<string, unknown>;
}
export async function enableDevicePush(ownerId: string, publicKey: string, signal: AbortSignal) {
  const epoch = generation;
  if (activeOwner !== ownerId) throw new Error("Your account changed.");
  if (Notification.permission === "denied")
    throw new Error("Notifications are blocked in your browser settings.");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  const permission = await withAbort(Notification.requestPermission(), deadline);
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const ready = await withAbort(
    registerPwa().then(() => navigator.serviceWorker.ready),
    deadline,
  );
  if (deadline.aborted || activeOwner !== ownerId || epoch !== generation)
    throw new Error("Your account changed.");
  await pwaMessage({ type: "UNSUBSCRIBE", ownerId }, deadline);
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/gu, "+").replace(/_/gu, "/")), (c) =>
    c.charCodeAt(0),
  );
  let savedBinding: Record<string, unknown> | null = null;
  const pendingSubscription = ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  // Browser permission/PushManager cannot be canceled. A late result is still
  // unsubscribed after the component or principal abandoned the request.
  void pendingSubscription
    .then((value) => {
      if (deadline.aborted || activeOwner !== ownerId || epoch !== generation)
        void value.unsubscribe().catch(() => {});
    })
    .catch(() => {});
  const subscription = await withAbort(pendingSubscription, deadline);
  try {
    if (deadline.aborted || activeOwner !== ownerId || epoch !== generation)
      throw new Error("Your account changed.");
    const json = subscription.toJSON(),
      value = await pushApi(ownerId, deadline, {
        action: "subscribe",
        subscription: { endpoint: json.endpoint, keys: json.keys },
      });
    const binding = {
      id: value.id,
      revision: value.revision,
      deviceSecret: value.deviceSecret,
      ownerId,
    };
    savedBinding = binding;
    if (activeOwner !== ownerId || epoch !== generation) throw new Error("Your account changed.");
    await pwaMessage({ type: "BIND", ownerId, binding }, deadline);
    return binding;
  } catch (error) {
    if (savedBinding)
      void fetch("/api/push/revoke-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ id: savedBinding.id, deviceSecret: savedBinding.deviceSecret }),
        keepalive: true,
      }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
    throw error;
  }
}
export async function disableDevicePush(ownerId: string, signal: AbortSignal) {
  if (activeOwner !== ownerId) throw new Error("Your account changed.");
  await pwaMessage({ type: "UNSUBSCRIBE", ownerId }, signal);
}
