import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { developerRateError } from "./developer-http-errors.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  developerFailure,
  developerJson,
} from "./developer-platform.server";
import { parseDeveloperUploadRequest } from "./developer-upload-policy.mjs";

export async function handleDeveloperUploads(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes("files")) throw new Error("developer_scope_required");
    if (runtimeEnv("KOVA_DEVELOPER_UPLOAD_SCHEMA_READY") !== "true")
      throw new Error("developer_upload_unavailable");
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperUploadRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 16384, request.signal)
        : undefined,
    );
    if (
      ["create", "append", "complete"].includes(parsed.operation) &&
      (runtimeEnv("KOVA_DEVELOPER_UPLOADS_ENABLED") !== "true" ||
        runtimeEnv("KOVA_DEVELOPER_FILES_ENABLED") !== "true")
    )
      throw new Error("developer_upload_unavailable");
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_uploads",
      limit: 60,
      windowSeconds: 60,
    });
    const rateError = developerRateError(rate);
    if (rateError) throw rateError;
    const result = await identity.db
      .rpc("manage_developer_uploads_v1", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: parsed.operation,
        p_input: parsed.input,
      })
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error || !result.data) {
      const known = result.error?.message?.match(
        /^developer_(?:upload_(?:not_found|quota_exceeded|state_conflict|offset_conflict|digest_conflict|invalid)|file_(?:invalid|quota_exceeded)|idempotency_conflict|scope_required|owner_unavailable|account_unavailable)$/,
      )?.[0];
      throw new Error(known ?? "developer_upload_unavailable");
    }
    return developerJson(result.data, parsed.operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
