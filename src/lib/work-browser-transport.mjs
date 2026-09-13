import { signRunnerEnvelope, parseWorkRunnerConfiguration } from "./work-runner-transport.mjs";
import { WORK_EXECUTION_PROTOCOL, workUuid } from "./work-execution-protocol.mjs";
const fail = () => {
  throw new Error("work_browser_transport_denied");
};
async function verify(secret, direction, raw, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature ?? "")) fail();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(signature.match(/../g), (v) => parseInt(v, 16)),
      new TextEncoder().encode(`kova-work-v1:${direction}\n${raw}`),
    ))
  )
    fail();
}
export async function verifyBrowserInvocation(configuration, raw, signature) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true });
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 4096) fail();
  await verify(config.signingKey, "request", raw, signature);
  const value = JSON.parse(raw);
  if (
    value.protocol !== WORK_EXECUTION_PROTOCOL ||
    value.runnerId !== config.id ||
    value.build !== config.build ||
    !Number.isSafeInteger(value.at) ||
    Math.abs(Date.now() - value.at) > 15000 ||
    value.operation !== "browser_authorize"
  )
    fail();
  workUuid(value.requestId);
  const input = value.payload;
  if (
    !input ||
    !["check", "admit_agent", "catalog"].includes(input.phase) ||
    !["owner", "agent"].includes(input.actor) ||
    Object.keys(input).some(
      (k) =>
        ![
          "phase",
          "ownerId",
          "runId",
          "sessionId",
          "actor",
          "sequence",
          "epoch",
          "stepId",
          "inputHash",
          "approvalId",
        ].includes(k),
    )
  )
    fail();
  for (const key of ["ownerId", "runId", "sessionId"]) workUuid(input[key]);
  if (input.actor === "agent") {
    workUuid(input.stepId);
    if (
      !Number.isSafeInteger(input.epoch) ||
      input.epoch < 1 ||
      !/^[a-f0-9]{64}$/.test(input.inputHash ?? "")
    )
      fail();
    if (input.phase !== "catalog") workUuid(input.approvalId);
  }
  if (input.phase === "check" && (!Number.isSafeInteger(input.sequence) || input.sequence < 1))
    fail();
  return { requestId: value.requestId, payload: input };
}
async function exchange(configuration, url, operation, payload, signal, fetcher, maximum) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true }),
    requestId = crypto.randomUUID();
  const body = JSON.stringify({
    protocol: WORK_EXECUTION_PROTOCOL,
    runnerId: config.id,
    build: config.build,
    requestId,
    at: Date.now(),
    operation,
    payload,
  });
  if (new TextEncoder().encode(body).length > 16000) fail();
  const response = await fetcher(url, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Kova-Signature": await signRunnerEnvelope(config.signingKey, "request", body),
    },
    body,
  });
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    fail();
  const reader = response.body?.getReader();
  if (!reader) fail();
  let raw = "",
    size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        fail();
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  await verify(config.signingKey, "response", raw, response.headers.get("x-kova-signature"));
  const result = JSON.parse(raw);
  if (
    result.protocol !== WORK_EXECUTION_PROTOCOL ||
    result.runnerId !== config.id ||
    result.build !== config.build ||
    result.requestId !== requestId ||
    !Number.isSafeInteger(result.at) ||
    Math.abs(Date.now() - result.at) > 30000
  )
    fail();
  return result.payload;
}
export async function browserRunnerCommand(configuration, input, signal, fetcher = fetch) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true });
  return exchange(
    config,
    `${config.origin}/v1/work/browser`,
    "browser",
    input,
    signal,
    fetcher,
    65536,
  );
}
export async function browserRunnerCapabilities(configuration, signal, fetcher = fetch) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true });
  const payload = await exchange(
    config,
    `${config.origin}/v1/work/heartbeat`,
    "heartbeat",
    {},
    signal,
    fetcher,
    16384,
  );
  const value = payload?.browserCapabilities;
  if (
    payload?.status !== "ready" ||
    payload.expiresAt <= Date.now() ||
    value?.protocol !== "kova-browser-v1" ||
    value.available !== true ||
    value.maxSessionSeconds !== 300 ||
    !Array.isArray(value.origins) ||
    !value.origins.length ||
    value.origins.length > 20
  )
    fail();
  for (const origin of value.origins) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      fail();
  }
  return {
    protocol: "kova-browser-v1",
    available: true,
    origins: [...value.origins],
    maxSessionSeconds: 300,
  };
}
export function createBrowserBackendAuthority(configuration, rawOrigin, fetcher = fetch) {
  const target = parseWorkRunnerConfiguration({
    ...configuration,
    origin: rawOrigin,
    enabled: true,
  });
  return async (payload, signal) => {
    const result = await exchange(
      configuration,
      `${target.origin}/api/internal/work-browser`,
      "browser_authorize",
      payload,
      signal,
      fetcher,
      4096,
    );
    if (
      result?.allowed !== true ||
      !Number.isSafeInteger(result.sequence) ||
      result.sequence < 0 ||
      !Number.isSafeInteger(result.expiresAt) ||
      result.expiresAt <= Date.now()
    )
      fail();
    return result;
  };
}
