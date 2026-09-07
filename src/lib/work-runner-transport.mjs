import { parseWorkModelCapabilities } from "./work-model-policy.mjs";
import {
  canonicalWorkInput,
  workInputHash,
  workUuid,
  WORK_EXECUTION_PROTOCOL,
  WORK_RUNNER_CAPABILITIES,
} from "./work-execution-protocol.mjs";

const HASH = /^[a-f0-9]{64}$/;
const OUTPUT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
export const WORK_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
const fail = (code) => {
  throw new Error(code);
};
const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export function parseWorkRunnerConfiguration(input) {
  if (!input || input.enabled !== true) return null;
  let url;
  try {
    url = new URL(input.origin);
  } catch {
    fail("work_runner_configuration_invalid");
  }
  // This target is operator-owned server configuration, never request input.
  // IP literals, single-label/private names, credentials, redirects, and paths
  // cannot convert the transport into a user-controlled fetch proxy.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(url.hostname) ||
    !/^[a-f0-9]{40,64}$/.test(input.build ?? "") ||
    typeof input.token !== "string" ||
    input.token.length < 32 ||
    input.token.length > 512 ||
    typeof input.signingKey !== "string" ||
    input.signingKey.length < 32 ||
    input.signingKey.length > 512
  )
    fail("work_runner_configuration_invalid");
  return Object.freeze({
    origin: url.origin,
    id: workUuid(input.id),
    build: input.build,
    token: input.token,
    signingKey: input.signingKey,
  });
}
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signRunnerEnvelope(secret, direction, body) {
  if (!["request", "response"].includes(direction)) fail("work_signature_invalid");
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      await key(secret),
      new TextEncoder().encode(`kova-work-v1:${direction}\n${body}`),
    ),
  );
}
async function verified(secret, signature, body) {
  if (!HASH.test(signature ?? "")) return false;
  const bytes = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    bytes,
    new TextEncoder().encode(`kova-work-v1:response\n${body}`),
  );
}
export async function verifyRunnerInvocation(configuration, raw, signature) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true });
  if (
    typeof raw !== "string" ||
    new TextEncoder().encode(raw).length > 4096 ||
    !HASH.test(signature ?? "")
  )
    fail("work_runner_invocation_invalid");
  const bytes = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      await key(config.signingKey),
      bytes,
      new TextEncoder().encode(`kova-work-v1:request\n${raw}`),
    ))
  )
    fail("work_runner_signature_invalid");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("work_runner_invocation_invalid");
  }
  if (
    input.protocol !== WORK_EXECUTION_PROTOCOL ||
    input.runnerId !== config.id ||
    input.build !== config.build ||
    !Number.isSafeInteger(input.at) ||
    Math.abs(Date.now() - input.at) > 15000 ||
    !["dispatch", "recover", "drain", "probe"].includes(input.operation) ||
    !input.payload ||
    Object.keys(input.payload).some(
      (name) => ["drain", "probe"].includes(input.operation) || name !== "runId",
    )
  )
    fail("work_runner_invocation_invalid");
  return {
    operation: input.operation,
    runId: ["drain", "probe"].includes(input.operation) ? null : workUuid(input.payload.runId),
    requestId: workUuid(input.requestId),
  };
}
async function boundedText(response, maximum) {
  if (!response.body) fail("work_runner_response_invalid");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    result = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        fail("work_runner_response_too_large");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
function attemptBinding(input) {
  if (
    !input ||
    !Number.isSafeInteger(input.epoch) ||
    input.epoch < 1 ||
    !HASH.test(input.inputHash ?? "")
  )
    fail("work_attempt_invalid");
  return {
    runId: workUuid(input.runId),
    ownerId: workUuid(input.ownerId),
    epoch: input.epoch,
    stepId: workUuid(input.stepId),
    inputHash: input.inputHash,
  };
}
function validateAttempt(result, binding) {
  const status = result?.status;
  if (
    ![
      "accepted",
      "running",
      "completed",
      "question",
      "approval_required",
      "effect_completed",
      "cancelled",
      "failed",
      "unknown",
      "not_executed",
    ].includes(status)
  )
    fail("work_attempt_status_invalid");
  for (const [key, value] of Object.entries(binding))
    if (result[key] !== value) fail("work_attempt_binding_invalid");
  if (status !== "unknown") workUuid(result.attemptId);
  if (
    ["completed", "question", "approval_required", "effect_completed", "not_executed"].includes(
      status,
    ) ||
    result.receipt
  ) {
    const receipt = result.receipt;
    if (
      !receipt ||
      receipt.runId !== binding.runId ||
      receipt.ownerId !== binding.ownerId ||
      receipt.epoch !== binding.epoch ||
      receipt.stepId !== binding.stepId ||
      receipt.inputHash !== binding.inputHash ||
      !Array.isArray(receipt.outputs) ||
      receipt.outputs.length > 20
    )
      fail("work_runner_receipt_invalid");
    workUuid(receipt.reservationId);
    const directive = receipt.directive;
    if (
      status === "question" &&
      (directive?.kind !== "question" ||
        typeof directive.text !== "string" ||
        !directive.text.trim() ||
        directive.text.length > 4000)
    )
      fail("work_runner_directive_invalid");
    if (
      status === "approval_required" &&
      (directive?.kind !== "approval" ||
        typeof directive.action !== "string" ||
        new TextEncoder().encode(canonicalWorkInput(directive.input)).length > 12000)
    )
      fail("work_runner_directive_invalid");
    if (
      status === "effect_completed" &&
      (directive?.kind !== "effect_result" ||
        !["completed", "not_executed", "failed"].includes(directive.outcome))
    )
      fail("work_runner_directive_invalid");
    if (directive && directive.kind !== "failure") workUuid(directive.id);
    if (status === "completed" && directive) fail("work_runner_directive_invalid");
    // Empty completed receipts remain accounted evidence; the state machine
    // durably fails them instead of dropping the step and replaying the objective.

    for (const field of [
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
      "reasoningTokens",
      "latencyMs",
      "costMicros",
    ]) {
      if (!Number.isSafeInteger(receipt[field]) || receipt[field] < 0)
        fail("work_runner_usage_invalid");
    }
    if (
      status === "not_executed" &&
      (receipt.outputs.length ||
        receipt.directive ||
        [
          "inputTokens",
          "outputTokens",
          "cachedInputTokens",
          "reasoningTokens",
          "latencyMs",
          "costMicros",
        ].some((field) => receipt[field] !== 0))
    )
      fail("work_nonexecution_proof_invalid");
    receipt.outputs.forEach((output) => {
      workUuid(output.artifactId);
      if (
        !HASH.test(output.sha256 ?? "") ||
        !OUTPUT_MIMES.has(output.mimeType) ||
        !Number.isSafeInteger(output.bytes) ||
        output.bytes < 1 ||
        output.bytes > WORK_ARTIFACT_MAX_BYTES ||
        Object.keys(output).some(
          (name) => !["artifactId", "sha256", "mimeType", "bytes"].includes(name),
        )
      )
        fail("work_runner_artifact_invalid");
    });
  }
  return result;
}

export function createWorkRunnerTransport(configuration, fetcher = fetch) {
  const config = parseWorkRunnerConfiguration({ ...configuration, enabled: true });
  async function request(operation, payload, signal, maximum = 131072) {
    const requestId = crypto.randomUUID();
    const envelope = {
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: config.id,
      build: config.build,
      requestId,
      at: Date.now(),
      operation,
      payload,
    };
    const body = canonicalWorkInput(envelope);
    const response = await fetcher(`${config.origin}/v1/work/${operation}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        "X-Kova-Signature": await signRunnerEnvelope(config.signingKey, "request", body),
        "Idempotency-Key": payload.runId
          ? `${payload.runId}:${payload.epoch}:${payload.stepId}:${operation}`
          : requestId,
      },
      body,
    });
    if (
      !response.ok ||
      response.redirected ||
      (response.url && new URL(response.url).origin !== config.origin) ||
      response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      fail("work_runner_transport_unavailable");
    const raw = await boundedText(response, maximum);
    if (!(await verified(config.signingKey, response.headers.get("x-kova-signature"), raw)))
      fail("work_runner_signature_invalid");
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      fail("work_runner_response_invalid");
    }
    if (
      result.protocol !== WORK_EXECUTION_PROTOCOL ||
      result.runnerId !== config.id ||
      result.build !== config.build ||
      result.requestId !== requestId ||
      !Number.isSafeInteger(result.at) ||
      Math.abs(Date.now() - result.at) > 15000
    )
      fail("work_runner_response_binding_invalid");
    return result.payload;
  }
  return Object.freeze({
    async cleanupOwner(ownerId, signal) {
      workUuid(ownerId);
      const result = await request("owner_cleanup", { ownerId }, signal);
      if (
        result?.ownerId !== ownerId ||
        !["draining", "clean"].includes(result.status) ||
        (result.status === "clean" && result.retired !== true)
      )
        fail("work_owner_cleanup_unconfirmed");
      return result.status === "clean";
    },
    async dispatch(input, signal) {
      const payload = {
        runId: workUuid(input.runId),
        ownerId: workUuid(input.ownerId),
        requestHash: input.requestHash,
      };
      if (!HASH.test(payload.requestHash ?? "")) fail("work_dispatch_invalid");
      const result = await request("dispatch", payload, signal);
      if (
        result?.status !== "accepted" ||
        result.durable !== true ||
        Object.entries(payload).some(([name, value]) => result[name] !== value)
      )
        fail("work_dispatch_unconfirmed");
      return result;
    },
    async heartbeat(signal) {
      const payload = await request("heartbeat", {}, signal);
      const now = Date.now();
      if (
        payload?.status !== "ready" ||
        payload.protocol !== WORK_EXECUTION_PROTOCOL ||
        !Array.isArray(payload.capabilities) ||
        !WORK_RUNNER_CAPABILITIES.every((item) => payload.capabilities.includes(item)) ||
        !Number.isSafeInteger(payload.heartbeatAt) ||
        payload.heartbeatAt > now ||
        now - payload.heartbeatAt >= 30000 ||
        !Number.isSafeInteger(payload.expiresAt) ||
        payload.expiresAt <= now ||
        payload.expiresAt > now + 60000
      )
        fail("work_runner_unavailable");
      return {
        id: config.id,
        build: config.build,
        protocol: WORK_EXECUTION_PROTOCOL,
        authenticated: true,
        enabled: true,
        heartbeatAt: payload.heartbeatAt,
        expiresAt: payload.expiresAt,
        capabilities: payload.capabilities,
        modelCapabilities: parseWorkModelCapabilities(payload.modelCapabilities ?? []),
      };
    },
    async submit(input, signal) {
      if (
        Object.keys(input).some(
          (name) =>
            ![
              "runId",
              "ownerId",
              "epoch",
              "stepId",
              "model",
              "reasoningEffort",
              "objective",
              "sessionContext",
              "directions",
              "answer",
              "maxTokens",
              "maxOutputTokens",
              "approval",
              "effectResult",
              "maxCostMicros",
              "reservationId",
            ].includes(name),
        )
      )
        fail("work_attempt_field_invalid");
      workUuid(input.reservationId);
      const binding = attemptBinding({ ...input, inputHash: await workInputHash(input) });
      const payload = { ...input, inputHash: binding.inputHash };
      return validateAttempt(await request("submit", payload, signal), binding);
    },
    async status(input, signal) {
      const binding = attemptBinding(input);
      return validateAttempt(await request("status", binding, signal), binding);
    },
    async cancel(input, signal) {
      const binding = attemptBinding(input);
      return validateAttempt(await request("cancel", binding, signal), binding);
    },
    async sealUndispatched(input, signal) {
      const binding = attemptBinding(input);
      const reservationId = workUuid(input.reservationId);
      const result = validateAttempt(
        await request("seal_undispatched", { ...binding, reservationId }, signal),
        binding,
      );
      if (result.status === "not_executed" && result.receipt.reservationId !== reservationId)
        fail("work_nonexecution_proof_invalid");
      return result;
    },
    async reconcile(input, signal) {
      const binding = attemptBinding(input);
      // "unknown" remains unknown and cannot authorize a replay or completion.
      return validateAttempt(await request("reconcile", binding, signal), binding);
    },
    async artifact(input, output, signal) {
      const binding = attemptBinding(input);
      workUuid(output.artifactId);
      if (
        !HASH.test(output.sha256 ?? "") ||
        !Number.isSafeInteger(output.bytes) ||
        output.bytes < 1 ||
        output.bytes > WORK_ARTIFACT_MAX_BYTES ||
        !OUTPUT_MIMES.has(output.mimeType)
      )
        fail("work_runner_artifact_invalid");
      const payload = await request(
        "artifact",
        { ...binding, artifactId: output.artifactId },
        signal,
        WORK_ARTIFACT_MAX_BYTES * 1.4 + 16384,
      );
      if (
        Object.entries(binding).some(([name, value]) => payload[name] !== value) ||
        payload.artifactId !== output.artifactId ||
        payload.mimeType !== output.mimeType ||
        payload.sha256 !== output.sha256 ||
        payload.bytes !== output.bytes ||
        typeof payload.contentBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          payload.contentBase64,
        )
      )
        fail("work_runner_artifact_binding_invalid");
      const bytes = Uint8Array.from(atob(payload.contentBase64), (character) =>
        character.charCodeAt(0),
      );
      if (
        bytes.byteLength !== output.bytes ||
        hex(await crypto.subtle.digest("SHA-256", bytes)) !== output.sha256
      )
        fail("work_runner_artifact_hash_invalid");
      return { ...output, ...binding, content: bytes };
    },
  });
}

/** Cleanup follows the stable runner identity across normal build upgrades. */
export function workRunnerMatchesOwnerHistory(configuration, records) {
  return Boolean(
    configuration &&
    Array.isArray(records) &&
    records.every((row) => row?.state?.runnerId === configuration.id),
  );
}
