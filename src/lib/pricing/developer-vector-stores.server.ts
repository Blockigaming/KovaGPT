import { developerRateError } from "./developer-http-errors.mjs";
import { createHash } from "node:crypto";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  developerFailure,
  developerJson,
} from "./developer-platform.server";
import { developerRequestKey } from "./developer-platform-policy.mjs";
import { parseDeveloperVectorRequest } from "./developer-vector-policy.mjs";

export async function handleDeveloperVectorStores(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes("files") || !identity.capabilities.includes("embeddings"))
      throw new Error("developer_scope_required");
    if (
      runtimeEnv("KOVA_DEVELOPER_VECTOR_SCHEMA_READY") !== "true" ||
      runtimeEnv("KOVA_DEVELOPER_VECTOR_STORES_ENABLED") !== "true"
    )
      throw new Error("developer_vector_unavailable");
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_vector_stores",
      limit: 20,
      windowSeconds: 60,
    });
    const rateError = developerRateError(rate);
    if (rateError) throw rateError;
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperVectorRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 65536, request.signal)
        : undefined,
    );
    if (parsed.operation === "create") {
      const key = developerRequestKey(request.headers.get("idempotency-key"));
      parsed.input.request_digest = createHash("sha256")
        .update(`${identity.id}:${key}`)
        .digest("hex");
    }
    const result = await identity.db
      .rpc("manage_developer_vector_stores_v1", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: parsed.operation,
        p_input: parsed.input,
      })
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error || !result.data) {
      const known = result.error?.message?.match(
        /^developer_(?:vector_not_found|vector_quota_exceeded|vector_conflict|vector_invalid|scope_required|owner_unavailable)$/,
      )?.[0];
      if (known === "developer_vector_not_found")
        return developerJson({ error: { code: known, message: "vector resource not found" } }, 404);
      if (known === "developer_vector_quota_exceeded")
        return developerJson({ error: { code: known, message: "vector quota exceeded" } }, 409);
      throw new Error(known ?? "developer_vector_unavailable");
    }
    return developerJson(result.data, parsed.operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
