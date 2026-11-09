// Only power operations on the exact operator-configured VM. No resource writes,
// resizing, deletion, provider inference, or credentials from browser input.
const RESOURCE =
  /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-zA-Z0-9_.()-]{1,90}\/providers\/Microsoft\.Compute\/virtualMachines\/[a-zA-Z0-9_-]{1,64}$/;
export function parseWorkHostPowerConfiguration(env) {
  if (env("KOVA_WORK_HOST_POWER_ENABLED") !== "true") return null;
  const resourceId = env("KOVA_WORK_HOST_VM_RESOURCE_ID");
  if (typeof resourceId !== "string" || !RESOURCE.test(resourceId))
    throw new Error("work_host_configuration_invalid");
  return { resourceId };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("work_host_response_invalid");
  let size = 0,
    raw = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("work_host_response_invalid");
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function createWorkHostPower({ resourceId, getToken, fetcher = fetch }) {
  if (!RESOURCE.test(resourceId) || typeof getToken !== "function")
    throw new Error("work_host_configuration_invalid");
  let waking;
  async function request(operation, method) {
    const response = await fetcher(
      `https://management.azure.com${resourceId}/${operation}?api-version=2024-07-01`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${await getToken()}` },
      },
    );
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => undefined);
      const error = new Error("work_host_power_unavailable");
      error.confirmedRejection = [400, 401, 403, 404].includes(response.status);
      throw error;
    }
    return response;
  }
  async function state() {
    const value = await boundedJson(await request("instanceView", "GET"));
    const code = value.statuses?.find((entry) => entry.code?.startsWith("PowerState/"))?.code;
    if (
      !["running", "starting", "stopping", "stopped", "deallocating", "deallocated"].some(
        (item) => code === `PowerState/${item}`,
      )
    )
      throw new Error("work_host_state_unknown");
    return code.slice("PowerState/".length);
  }
  return {
    state,
    wake() {
      // Collapse simultaneous wake requests within an app instance. ARM start is
      // idempotent across replicas; stopping is observed and retried, never opposed.
      if (!waking)
        waking = (async () => {
          const current = await state();
          if (["stopped", "deallocated"].includes(current)) {
            const response = await request("start", "POST");
            await response.body?.cancel();
            return "starting";
          }
          return ["stopping", "deallocating"].includes(current) ? "stopping" : current;
        })().finally(() => {
          waking = undefined;
        });
      return waking;
    },
    async suspend() {
      const response = await request("deallocate", "POST");
      await response.body?.cancel();
      return "stopping";
    },
  };
}

// Admission fencing and idle time are local to the single reviewed runner.
// A separate always-on application watchdog recovers durable queued work if
// admission races deallocation. Readiness polling never renews the idle timer.
export function createWorkHostIdleControl({ idleMs = 900000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(idleMs) || idleMs < 900000 || idleMs > 3600000)
    throw new Error("work_host_idle_policy_invalid");
  let lastActivity = now(),
    requests = 0,
    draining = false;
  return {
    enter() {
      if (draining) throw new Error("work_host_stopping");
      requests++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          requests--;
        }
      };
    },
    touch() {
      lastActivity = now();
    },
    get draining() {
      return draining;
    },
    async suspendIfIdle({ localIdle, backendIdle, suspend }) {
      if (draining || requests || now() - lastActivity < idleMs || !localIdle()) return false;
      // Fence requests before awaiting any remote state. Unknown backend state
      // or a rejected ARM operation leaves the host running and reopens admission.
      draining = true;
      let suspensionAttempted = false;
      try {
        if (!(await backendIdle()) || !localIdle()) {
          draining = false;
          return false;
        }
        suspensionAttempted = true;
        await suspend();
        return true;
      } catch (error) {
        // A lost ARM acknowledgement can still shut down this host. Never
        // accept new provider work at that ambiguous boundary. Queued work is
        // durable; an operator must reconcile if the VM remains running.
        draining = suspensionAttempted && error?.confirmedRejection !== true;
        lastActivity = now();
        return false;
      }
    },
  };
}
