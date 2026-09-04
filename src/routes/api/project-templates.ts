import { createFileRoute } from "@tanstack/react-router";
import { getCallerTier, requireUser, type AuthedCaller } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  parseProjectTemplateMutation,
  parseProjectTemplateQuery,
  PROJECT_TEMPLATE_MAX_BODY_BYTES,
  ProjectTemplateInputError,
  projectTemplateErrorStatus,
} from "@/lib/project-template-policy.mjs";

type QueryError = { code?: string | null };
type RpcResult = { data: unknown; error: QueryError | null };
type TemplateAdmin = {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

function adminFor(auth: AuthedCaller): TemplateAdmin {
  return auth.supabaseAdmin as unknown as TemplateAdmin;
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inputFailure(error: unknown): Response {
  if (error instanceof ProjectTemplateInputError) return json({ error: error.code }, 400);
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  return json({ error: "project_template_request_invalid" }, 400);
}

function databaseFailure(error: QueryError | null): Response {
  const status = projectTemplateErrorStatus(error?.code);
  return json(
    {
      error:
        status === 409
          ? "project_template_conflict"
          : status === 404
            ? "project_template_not_found"
            : status === 403
              ? "project_template_permission_denied"
              : status === 400
                ? "project_template_operation_invalid"
                : "project_templates_unavailable",
    },
    status,
  );
}

async function protect(
  auth: AuthedCaller,
  action: "project_template_read" | "project_template_mutation",
  limit: number,
): Promise<Response | null> {
  const rateLimit = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action,
    limit,
    windowSeconds: 60,
  });
  if (rateLimit.allowed) return null;
  return json(
    {
      error:
        rateLimit.status === "limited"
          ? "project_template_rate_limited"
          : "project_template_protection_unavailable",
    },
    rateLimit.status === "limited" ? 429 : 503,
    { "Retry-After": String(rateLimit.retryAfter) },
  );
}

export const Route = createFileRoute("/api/project-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const blocked = await protect(auth, "project_template_read", 120);
        if (blocked) return blocked;
        let query;
        try {
          query = parseProjectTemplateQuery(request.url);
        } catch (error) {
          return inputFailure(error);
        }
        const result = query.templateId
          ? await adminFor(auth).rpc("get_project_template_version", {
              p_user_id: auth.userId,
              p_template_id: query.templateId,
              p_version: query.version,
            })
          : await adminFor(auth).rpc("list_project_templates", {
              p_user_id: auth.userId,
              p_limit: query.limit,
            });
        if (result.error) return databaseFailure(result.error);
        if (!isRecord(result.data)) return json({ error: "project_template_result_invalid" }, 503);
        return json(result.data);
      },

      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return json({ error: "cross_site_request_blocked" }, 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const blocked = await protect(auth, "project_template_mutation", 60);
        if (blocked) return blocked;
        if (
          request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          return json({ error: "json_content_type_required" }, 415);
        }
        let input;
        try {
          input = parseProjectTemplateMutation(
            await readBoundedJsonObject(request, PROJECT_TEMPLATE_MAX_BODY_BYTES),
          );
        } catch (error) {
          return inputFailure(error);
        }
        let result: RpcResult;
        if (input.action === "create") {
          result = await adminFor(auth).rpc("create_project_template", {
            p_owner_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_name: input.name,
            p_description: input.description,
            p_snapshot: input.snapshot,
          });
        } else if (input.action === "publishVersion") {
          result = await adminFor(auth).rpc("publish_project_template_version", {
            p_owner_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_template_id: input.templateId,
            p_expected_revision: input.expectedRevision,
            p_snapshot: input.snapshot,
          });
        } else if (input.action === "share") {
          result = await adminFor(auth).rpc("share_project_template", {
            p_owner_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_template_id: input.templateId,
            p_expected_revision: input.expectedRevision,
            p_grantee_user_id: input.granteeUserId,
            p_can_copy: input.canCopy,
          });
        } else if (input.action === "revoke") {
          result = await adminFor(auth).rpc("revoke_project_template_grant", {
            p_owner_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_template_id: input.templateId,
            p_expected_revision: input.expectedRevision,
            p_grantee_user_id: input.granteeUserId,
          });
        } else if (input.action === "archive") {
          result = await adminFor(auth).rpc("archive_project_template", {
            p_owner_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_template_id: input.templateId,
            p_expected_revision: input.expectedRevision,
          });
        } else {
          const tier = await getCallerTier(auth);
          const projectLimit = tier === "pro" ? 200 : tier === "plus" ? 25 : 3;
          result = await adminFor(auth).rpc("copy_project_template", {
            p_user_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_template_id: input.templateId,
            p_version: input.version,
            p_project_limit: projectLimit,
          });
        }
        if (result.error) return databaseFailure(result.error);
        if (!isRecord(result.data)) return json({ error: "project_template_result_invalid" }, 503);
        return json({ result: result.data });
      },
    },
  },
});
