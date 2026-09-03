import { createFileRoute } from "@tanstack/react-router";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { requireUser, type AuthedCaller } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  LibraryFolderInputError,
  MAX_LIBRARY_MUTATION_BODY_BYTES,
  libraryMutationErrorStatus,
  parseCreateLibraryFolder,
  parseDeleteLibraryFolder,
  parseUpdateLibraryFolder,
} from "@/lib/library-folders-policy.mjs";

const FOLDER_FIELDS = "id,parent_id,name,position,created_at,updated_at";

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function contentTypeIsJson(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

async function readMutation(request: Request): Promise<unknown | Response> {
  if (!contentTypeIsJson(request)) return json({ error: "json_content_type_required" }, 415);
  try {
    return await readBoundedJsonObject(request, MAX_LIBRARY_MUTATION_BODY_BYTES);
  } catch (error) {
    if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
    return json({ error: "invalid_request_body" }, 400);
  }
}

async function authorizeMutation(
  request: Request,
): Promise<{ auth: AuthedCaller } | { response: Response }> {
  if (isCrossSiteMutation(request)) {
    return { response: json({ error: "cross_site_request_blocked" }, 403) };
  }
  const auth = await requireUser(request);
  if (auth instanceof Response) return { response: auth };
  const rateLimit = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action: "library_folder_mutation",
    limit: 100,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return {
      response: json(
        {
          error:
            rateLimit.status === "limited"
              ? "library_mutation_rate_limited"
              : "library_mutation_protection_unavailable",
        },
        rateLimit.status === "limited" ? 429 : 503,
        { "Retry-After": String(rateLimit.retryAfter) },
      ),
    };
  }
  return { auth };
}

function parseFailure(error: unknown): Response | null {
  if (!(error instanceof LibraryFolderInputError)) return null;
  return json({ error: error.code }, 400);
}

function databaseFailure(error: { code?: string } | null): Response {
  const status = libraryMutationErrorStatus(error?.code);
  const code =
    status === 409
      ? "library_folder_name_conflict"
      : status === 404
        ? "library_folder_not_found"
        : status === 400
          ? "invalid_library_folder_operation"
          : "library_folder_operation_failed";
  return json({ error: code }, status);
}

function rpcObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const Route = createFileRoute("/api/library/folders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const { data, error } = await auth.supabaseAdmin
          .from("library_folders" as never)
          .select(FOLDER_FIELDS)
          .eq("user_id", auth.userId)
          .order("parent_id", { ascending: true, nullsFirst: true })
          .order("position", { ascending: true })
          .order("name", { ascending: true })
          .limit(200);
        if (error) return json({ error: "library_folders_unavailable" }, 503);
        return json({ folders: data ?? [] });
      },
      POST: async ({ request }) => {
        const authorized = await authorizeMutation(request);
        if ("response" in authorized) return authorized.response;
        const body = await readMutation(request);
        if (body instanceof Response) return body;
        let input;
        try {
          input = parseCreateLibraryFolder(body);
        } catch (error) {
          return parseFailure(error) ?? json({ error: "invalid_request" }, 400);
        }
        const { data, error } = await authorized.auth.supabaseAdmin.rpc(
          "create_library_folder" as never,
          {
            p_user_id: authorized.auth.userId,
            p_name: input.name,
            p_parent_id: input.parentId,
          } as never,
        );
        const folder = rpcObject(data);
        if (error) return databaseFailure(error);
        if (!folder || typeof folder.id !== "string") {
          return json({ error: "library_folder_result_invalid" }, 503);
        }
        return json({ folder }, 201);
      },
      PATCH: async ({ request }) => {
        const authorized = await authorizeMutation(request);
        if ("response" in authorized) return authorized.response;
        const body = await readMutation(request);
        if (body instanceof Response) return body;
        let input;
        try {
          input = parseUpdateLibraryFolder(body);
        } catch (error) {
          return parseFailure(error) ?? json({ error: "invalid_request" }, 400);
        }
        const { data, error } = await authorized.auth.supabaseAdmin.rpc(
          "update_library_folder" as never,
          {
            p_user_id: authorized.auth.userId,
            p_folder_id: input.id,
            p_name: input.name,
            p_parent_id: input.parentId,
            p_parent_supplied: input.parentSupplied,
          } as never,
        );
        const folder = rpcObject(data);
        if (error) return databaseFailure(error);
        if (!folder || typeof folder.id !== "string") {
          return json({ error: "library_folder_result_invalid" }, 503);
        }
        return json({ folder });
      },
      DELETE: async ({ request }) => {
        const authorized = await authorizeMutation(request);
        if ("response" in authorized) return authorized.response;
        const body = await readMutation(request);
        if (body instanceof Response) return body;
        let input;
        try {
          input = parseDeleteLibraryFolder(body);
        } catch (error) {
          return parseFailure(error) ?? json({ error: "invalid_request" }, 400);
        }
        const { data, error } = await authorized.auth.supabaseAdmin.rpc(
          "delete_library_folder" as never,
          {
            p_user_id: authorized.auth.userId,
            p_folder_id: input.id,
          } as never,
        );
        const result = rpcObject(data);
        if (error) return databaseFailure(error);
        if (!result || typeof result.deletedFolderCount !== "number") {
          return json({ error: "library_folder_result_invalid" }, 503);
        }
        return json(result);
      },
    },
  },
});
