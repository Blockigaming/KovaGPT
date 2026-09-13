import { createHash } from "node:crypto";
import {
  canonicalWorkInput,
  workInputHash,
  workUuid,
} from "../src/lib/work-execution-protocol.mjs";

/** Typed pinned API and text-browser operations; never a generic fetch proxy. */
export function createWorkActionBroker({ operations, credentialFor }, fetcher = fetch) {
  const registry = new Map();
  for (const operation of operations) {
    const url = new URL(operation.url);
    if (
      !/^[a-z0-9_-]{1,64}$/.test(operation.id) ||
      registry.has(operation.id) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method) ||
      !["text", "json"].includes(operation.response) ||
      typeof operation.action !== "string"
    )
      throw new Error("work_operation_configuration_invalid");
    registry.set(operation.id, Object.freeze({ ...operation, url: url.href }));
  }
  function validate(action, input) {
    const operation = registry.get(input?.operationId);
    if (
      !operation ||
      action !== operation.action ||
      input.method !== operation.method ||
      input.url !== operation.url ||
      Object.keys(input).some((key) => !["operationId", "method", "url", "body"].includes(key)) ||
      new TextEncoder().encode(canonicalWorkInput(input)).length > 12000
    )
      throw new Error("work_operation_not_allowed");
    if (operation.method === "GET" && input.body !== null)
      throw new Error("work_operation_body_invalid");
    return operation;
  }
  return {
    catalog: () =>
      [...registry.values()].map(({ id, action, method, url, response }) => ({
        operationId: id,
        action,
        method,
        url,
        response,
      })),
    validate,
    async execute(input, { signal }) {
      workUuid(input.ownerId);
      workUuid(input.runId);
      const approval = input.approval;
      if (
        !approval ||
        approval.status !== "approved" ||
        !Number.isSafeInteger(approval.expiresAt) ||
        approval.expiresAt <= Date.now()
      )
        throw new Error("work_approval_stale");
      workUuid(approval.id);
      const approved = JSON.parse(approval.canonicalInput);
      if (
        canonicalWorkInput(approved) !== approval.canonicalInput ||
        (await workInputHash(approved)) !== approval.inputHash
      )
        throw new Error("work_approval_stale");
      const operation = validate(approval.action, approved);
      // Mutations and private reads require an owner-specific provider grant.
      // A shared operator token is never treated as blanket user permission.
      const grant =
        operation.public === true && operation.method === "GET"
          ? null
          : await credentialFor(input.ownerId, operation.id);
      if (
        !(operation.public === true && operation.method === "GET") &&
        (!grant ||
          grant.ownerId !== input.ownerId ||
          grant.operationId !== operation.id ||
          typeof grant.token !== "string" ||
          grant.token.length < 16 ||
          !Number.isSafeInteger(grant.expiresAt) ||
          grant.expiresAt <= Date.now())
      )
        throw new Error("work_provider_grant_missing");
      const result = await fetcher(operation.url, {
        method: operation.method,
        redirect: "error",
        credentials: "omit",
        signal,
        headers: {
          Accept: operation.response === "json" ? "application/json" : "text/plain, text/html",
          ...(grant ? { Authorization: `Bearer ${grant.token}` } : {}),
          ...(operation.method !== "GET" ? { "Content-Type": "application/json" } : {}),
          "Idempotency-Key": `work-effect:${input.runId}:${approval.id}`,
        },
        ...(operation.method !== "GET" ? { body: canonicalWorkInput(approved.body) } : {}),
      });
      if (!result.ok) return { outcome: "failed", result: { status: result.status } };
      const reader = result.body?.getReader();
      if (!reader) throw new Error("work_effect_receipt_missing");
      let size = 0,
        raw = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new Error("work_effect_response_limit");
          }
          raw += decoder.decode(item.value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      const sha256 = createHash("sha256").update(raw).digest("hex");
      // Text-browser mode never executes HTML, scripts, CSS, downloads or links.
      const text =
        operation.response === "text"
          ? raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, " ")
          : JSON.stringify(JSON.parse(raw));
      return {
        outcome: "completed",
        result: {
          url: operation.url,
          sha256,
          text: text.slice(0, 1500),
          truncated: text.length > 1500,
        },
      };
    },
  };
}
