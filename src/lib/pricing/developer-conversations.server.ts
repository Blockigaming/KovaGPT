import { developerRateError } from "./developer-http-errors.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  developerFailure,
  developerJson,
} from "./developer-platform.server";
import { parseDeveloperConversationRequest } from "./developer-conversation-policy.mjs";

export async function handleDeveloperConversations(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes("chat") && !identity.capabilities.includes("streaming"))
      throw new Error("developer_scope_required");
    if (
      runtimeEnv("KOVA_DEVELOPER_CONVERSATION_SCHEMA_READY") !== "true" ||
      runtimeEnv("KOVA_DEVELOPER_CONVERSATIONS_ENABLED") !== "true"
    )
      throw new Error("developer_conversation_unavailable");
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_conversations",
      limit: 30,
      windowSeconds: 60,
    });
    const rateError = developerRateError(rate);
    if (rateError) throw rateError;
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperConversationRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 16384, request.signal)
        : undefined,
    );
    const result = await identity.db
      .rpc("manage_developer_conversations_v1", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: parsed.operation,
        p_input: parsed.input,
      })
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error || !result.data) {
      const known = result.error?.message?.match(
        /^developer_(?:conversation_not_found|conversation_quota_exceeded|conversation_conflict|conversation_invalid|scope_required|owner_unavailable)$/,
      )?.[0];
      if (known === "developer_conversation_not_found")
        return developerJson(
          { error: { code: known, message: "conversation resource not found" } },
          404,
        );
      if (known === "developer_conversation_quota_exceeded")
        return developerJson(
          { error: { code: known, message: "conversation quota exceeded" } },
          409,
        );
      throw new Error(known ?? "developer_conversation_unavailable");
    }
    return developerJson(result.data, parsed.operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
