import { createFileRoute } from "@tanstack/react-router";
import { requireUser, requireVerifiedUser, type AuthedCaller } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  parseWorkSyncMutation,
  parseWorkSyncQuery,
  WORK_SYNC_MAX_BODY_BYTES,
  WORK_SYNC_MUTATION_RATE_POLICY,
  WORK_SYNC_READ_RATE_POLICY,
  WorkSyncInputError,
  workSyncErrorStatus,
} from "@/lib/work-sync-policy.mjs";

type QueryError = { code?: string | null };
type RpcResult = { data: unknown; error: QueryError | null };
type WorkSyncAdmin = {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

function adminFor(auth: AuthedCaller): WorkSyncAdmin {
  return auth.supabaseAdmin as unknown as WorkSyncAdmin;
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function inputFailure(error: unknown): Response {
  if (error instanceof WorkSyncInputError) return json({ error: error.code }, 400);
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  return json({ error: "work_sync_request_invalid" }, 400);
}

function databaseFailure(error: QueryError | null): Response {
  const code = error?.code;
  const status = workSyncErrorStatus(code);
  return json(
    {
      error:
        code === "P0003"
          ? "work_sync_rate_limited"
          : code === "54000"
            ? "work_sync_storage_quota_exceeded"
            : status === 409
              ? "work_sync_conflict"
              : status === 404
                ? "work_sync_record_not_found"
                : status === 400
                  ? "work_sync_operation_invalid"
                  : "work_sync_unavailable",
    },
    status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSnapshot(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Array.isArray(value.savedRecords) &&
    Array.isArray(value.recentItems) &&
    Number.isSafeInteger(value.nextCursor) &&
    Number.isSafeInteger(value.currentVersion) &&
    typeof value.hasMore === "boolean"
  );
}

async function protect(
  auth: AuthedCaller,
  policy: typeof WORK_SYNC_READ_RATE_POLICY | typeof WORK_SYNC_MUTATION_RATE_POLICY,
): Promise<Response | null> {
  const rateLimit = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    ...policy,
  });
  if (rateLimit.allowed) return null;
  return json(
    {
      error:
        rateLimit.status === "limited"
          ? "work_sync_rate_limited"
          : "work_sync_protection_unavailable",
    },
    rateLimit.status === "limited" ? 429 : 503,
    { "Retry-After": String(rateLimit.retryAfter) },
  );
}

export const Route = createFileRoute("/api/work/sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const blocked = await protect(auth, WORK_SYNC_READ_RATE_POLICY);
        if (blocked) return blocked;
        let query;
        try {
          query = parseWorkSyncQuery(request.url);
        } catch (error) {
          return inputFailure(error);
        }
        const result = await adminFor(auth).rpc("get_work_sync_changes", {
          p_user_id: auth.userId,
          p_after_version: query.cursor,
          p_limit: query.limit,
        });
        if (result.error) return databaseFailure(result.error);
        if (!validSnapshot(result.data)) return json({ error: "work_sync_result_invalid" }, 503);
        return json(result.data);
      },

      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return json({ error: "cross_site_request_blocked" }, 403);
        }
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const blocked = await protect(auth, WORK_SYNC_MUTATION_RATE_POLICY);
        if (blocked) return blocked;
        if (
          request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          return json({ error: "json_content_type_required" }, 415);
        }
        let input;
        try {
          input = parseWorkSyncMutation(
            await readBoundedJsonObject(request, WORK_SYNC_MAX_BODY_BYTES),
          );
        } catch (error) {
          return inputFailure(error);
        }
        let result: RpcResult;
        if (input.action === "save") {
          result = await adminFor(auth).rpc("upsert_work_saved_record", {
            p_user_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_id: input.id,
            p_kind: input.kind,
            p_title: input.title,
            p_payload: input.payload,
            p_expected_revision: input.expectedRevision,
          });
        } else if (input.action === "delete") {
          result = await adminFor(auth).rpc("delete_work_saved_record", {
            p_user_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_id: input.id,
            p_expected_revision: input.expectedRevision,
          });
        } else {
          result = await adminFor(auth).rpc("mutate_work_recent_item", {
            p_user_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_resource_type: input.resourceType,
            p_resource_id: input.resourceId,
            p_operation: input.pin,
            p_expected_revision: input.expectedRevision,
          });
        }
        if (result.error) return databaseFailure(result.error);
        if (!isRecord(result.data)) return json({ error: "work_sync_result_invalid" }, 503);
        return json({ result: result.data });
      },
    },
  },
});
