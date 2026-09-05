import {
  canonicalWorkInput,
  WORK_EXECUTION_PROTOCOL,
} from "../src/lib/work-execution-protocol.mjs";
import { signRunnerEnvelope } from "../src/lib/work-runner-transport.mjs";

/** Bounded authenticated callbacks to the configured application origin. */
export function createWorkBackend(configuration, rawOrigin, fetcher = fetch) {
  const origin = new URL(rawOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("work_backend_configuration_invalid");
  return async (operation, runId) => {
    if (!["probe", "drain", "dispatch", "recover"].includes(operation))
      throw new Error("work_backend_operation_invalid");
    const body = canonicalWorkInput({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: configuration.id,
      build: configuration.build,
      requestId: crypto.randomUUID(),
      at: Date.now(),
      operation,
      payload: runId ? { runId } : {},
    });
    const response = await fetcher(`${origin.origin}/api/internal/work-execution`, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(operation === "probe" ? 10000 : 35000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${configuration.token}`,
        "X-Kova-Signature": await signRunnerEnvelope(configuration.signingKey, "request", body),
      },
      body,
    });
    if (
      !response.ok ||
      response.redirected ||
      response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("work_backend_unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("work_backend_response_invalid");
    let bytes = 0,
      raw = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) {
          await reader.cancel();
          throw new Error("work_backend_response_limit");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(raw);
    if (operation === "probe" && result?.status !== "ready")
      throw new Error("work_backend_unavailable");
    return result;
  };
}

export async function probeWorkRunner(sandbox, notify) {
  const isolation = await sandbox.probe();
  if (isolation?.ready !== true) throw new Error("work_isolation_unavailable");
  const backend = await notify("probe", null);
  if (backend?.status !== "ready") throw new Error("work_backend_unavailable");
  return true;
}
