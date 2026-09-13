import { createHash } from "node:crypto";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  developerDatabase,
  developerFailure,
  developerJson,
} from "./developer-platform.server";
import { developerUuid, developerRequestKey } from "./developer-platform-policy.mjs";
import { developerFileUpload } from "./developer-file-policy.mjs";

export async function handleDeveloperFiles(request: Request, ownerConsole = false) {
  try {
    let ownerId: string,
      keyId: string | null = null,
      projectId: string | null = null;
    const url = new URL(request.url);
    if (ownerConsole) {
      if (isCrossSiteMutation(request)) throw new Error("developer_origin_invalid");
      const caller = await requireVerifiedUser(request);
      if (caller instanceof Response) return caller;
      if (request.headers.get("x-kova-expected-user") !== caller.userId)
        throw new Error("developer_principal_conflict");
      ownerId = caller.userId;
      if (url.searchParams.has("project"))
        projectId = developerUuid(url.searchParams.get("project"));
      const rate = await consumeApplicationRateLimit({
        identity: `user:${ownerId}`,
        action: "developer_files_console",
        limit: 60,
        windowSeconds: 60,
      });
      if (!rate.allowed) throw new Error("developer_rate_limit");
    } else {
      const identity = await authenticateDeveloper(request);
      if (!identity.capabilities.includes("files")) throw new Error("developer_scope_required");
      ownerId = identity.ownerId;
      keyId = identity.id;
      projectId = identity.project_id;
    }
    const db = developerDatabase();
    let operation: string, input: Record<string, unknown>;
    if (request.method === "POST") {
      if (ownerConsole) throw new Error("developer_operation_invalid");
      if (runtimeEnv("KOVA_DEVELOPER_FILES_ENABLED") !== "true")
        throw new Error("developer_files_disabled");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
        throw new Error("developer_json_required");
      operation = "create";
      const requestKey = developerRequestKey(request.headers.get("idempotency-key"));
      input = {
        ...developerFileUpload(await readBoundedJsonObject(request, 131072)),
        requestDigest: createHash("sha256").update(requestKey).digest("hex"),
      };
    } else if (["GET", "DELETE"].includes(request.method)) {
      const id = url.searchParams.get("id");
      if (request.method === "DELETE" && !id) throw new Error("developer_id_invalid");
      operation = id ? (request.method === "DELETE" ? "delete" : "get") : "list";
      input = id ? { id: developerUuid(id) } : { page: Number(url.searchParams.get("page") ?? 0) };
      if (
        operation === "list" &&
        (!Number.isSafeInteger(input.page) || Number(input.page) < 0 || Number(input.page) > 4)
      )
        throw new Error("developer_page_invalid");
    } else throw new Error("developer_operation_invalid");
    const result = await db
      .rpc("manage_developer_files", {
        p_owner: ownerId,
        p_key: keyId,
        p_project: projectId,
        p_operation: operation,
        p_input: input,
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data) {
      const known = result.error?.message?.match(
        /^developer_(?:file_not_found|file_quota_exceeded|idempotency_conflict|scope_required|file_invalid|owner_unavailable|account_unavailable)$/,
      )?.[0];
      throw new Error(known ?? "developer_file_unavailable");
    }
    return developerJson(result.data, operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
