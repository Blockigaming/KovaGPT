import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";

const bindingKey = "kova.android-push.binding";
type Binding = { id: string; deviceSecret: string; ownerId: string };
type NativeBridge = EventTarget & { postMessage(message: string): void };

function binding(): Binding | null {
  const value = localStorage.getItem(bindingKey);
  return value ? (JSON.parse(value) as Binding) : null;
}

export function androidTaskPushEnabled(ownerId: string) {
  return binding()?.ownerId === ownerId;
}

async function revoke(value: Binding) {
  const response = await fetch("/api/push/revoke-device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: value.id, deviceSecret: value.deviceSecret }),
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Could not disable task notifications. Try again.");
}

export async function clearAndroidTaskPush(ownerId: string | null) {
  if (typeof window === "undefined") return;
  const current = binding();
  if (!current || current.ownerId !== ownerId) return;
  await revoke(current);
  if (binding()?.id === current.id) localStorage.removeItem(bindingKey);
}

export async function enableAndroidTaskPush(ownerId: string, signal: AbortSignal) {
  const previous = binding();
  if (previous) await clearAndroidTaskPush(previous.ownerId);
  signal.throwIfAborted();
  const bridge = (window as Window & { kovaNative?: NativeBridge }).kovaNative;
  if (!bridge) throw new Error("Native notifications are unavailable.");
  const requestId = crypto.randomUUID();
  const token = await new Promise<string>((resolve, reject) => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
    const cleanup = () => {
      bridge.removeEventListener("message", read);
      deadline.removeEventListener("abort", abort);
    };
    const read = (event: Event) => {
      const data: unknown = (event as MessageEvent).data;
      if (typeof data !== "string" || !data.startsWith(`${requestId}:`)) return;
      cleanup();
      const token = data.slice(requestId.length + 1);
      if (/^[A-Za-z0-9_:-]{20,2048}$/u.test(token)) resolve(token);
      else reject(new Error("Allow notifications in Android settings and try again."));
    };
    const abort = () => {
      cleanup();
      reject(deadline.reason);
    };
    bridge.addEventListener("message", read);
    deadline.addEventListener("abort", abort, { once: true });
    try {
      deadline.throwIfAborted();
      bridge.postMessage(JSON.stringify({ action: "push-token", requestId }));
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  signal.throwIfAborted();
  const response = await fetchWithTimeoutAuthenticated("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kova-Owner": ownerId },
    body: JSON.stringify({ action: "subscribe_android", expectedUserId: ownerId, token }),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Could not enable task notifications. Try again.");
  const { id, deviceSecret } = await response.json();
  if (typeof id !== "string" || typeof deviceSecret !== "string")
    throw new Error("Invalid push registration.");
  const value = { id, deviceSecret, ownerId };
  try {
    signal.throwIfAborted();
    localStorage.setItem(bindingKey, JSON.stringify(value));
  } catch (error) {
    await revoke(value);
    throw error;
  }
}
