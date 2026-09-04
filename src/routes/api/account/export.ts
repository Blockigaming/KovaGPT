import { createFileRoute } from "@tanstack/react-router";
import { requireUser, type AuthedCaller } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { isUuid, publicAccountExportJob } from "@/lib/account-export-policy.mjs";
import { clearAccountExportArtifacts } from "@/lib/account-export.server";

const BUCKET = "account-exports";
const JOB_COLUMNS =
  "id,status,requested_at,completed_at,expires_at,size_bytes,failure_code,storage_path";

type QueryError = { code?: string | null; message: string };
type QueryResult = { data: Record<string, unknown> | null; error: QueryError | null };
type ExportQuery = {
  select(columns?: string): ExportQuery;
  eq(column: string, value: unknown): ExportQuery;
  order(column: string, options?: { ascending?: boolean }): ExportQuery;
  limit(value: number): ExportQuery;
  insert(value: unknown): ExportQuery;
  update(value: unknown): ExportQuery;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
};
type ExportAdmin = {
  from(table: string): ExportQuery;
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{
        data: { signedUrl?: string } | null;
        error: QueryError | null;
      }>;
      remove(paths: string[]): Promise<{ error: QueryError | null }>;
    };
  };
};

function adminFor(auth: AuthedCaller): ExportAdmin {
  return auth.supabaseAdmin as unknown as ExportAdmin;
}

function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}

function bodyError(error: unknown): Response {
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  return json({ error: "invalid_request_body" }, 400);
}

async function latestJob(auth: AuthedCaller): Promise<QueryResult> {
  return adminFor(auth)
    .from("account_export_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", auth.userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function writeAudit(
  auth: AuthedCaller,
  jobId: string,
  description: string,
  result: "success" | "failure" = "success",
) {
  const inserted = await adminFor(auth)
    .from("account_audit_entries")
    .insert({
      user_id: auth.userId,
      event_type: "account_export",
      safe_description: description,
      actor_id: auth.userId,
      target_id: jobId,
      result,
      metadata: { format_version: 1 },
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error("account_export_audit_failed");
}

export const Route = createFileRoute("/api/account/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const result = await latestJob(auth);
        if (result.error) return json({ error: "account_export_status_unavailable" }, 503);
        if (!result.data) return json({ job: null });
        let job;
        try {
          job = publicAccountExportJob(result.data);
        } catch {
          return json({ error: "account_export_status_invalid" }, 503);
        }
        const url = new URL(request.url);
        if (
          url.searchParams.size > 1 ||
          [...url.searchParams.keys()].some((key) => key !== "download")
        ) {
          return json({ error: "invalid_query" }, 400);
        }
        if (url.searchParams.get("download") !== "1") return json({ job });
        if (!job.downloadable || typeof result.data.storage_path !== "string") {
          return json({ error: "account_export_not_ready", job }, 409);
        }
        const signed = await adminFor(auth)
          .storage.from(BUCKET)
          .createSignedUrl(result.data.storage_path, 300);
        if (signed.error || !signed.data?.signedUrl) {
          return json({ error: "account_export_download_unavailable" }, 503);
        }
        return json({
          job,
          downloadUrl: signed.data.signedUrl,
          downloadExpiresInSeconds: 300,
        });
      },

      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return json({ error: "cross_site_account_change" }, 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          const body = await readBoundedJsonObject(request, 512);
          if (Object.keys(body).length !== 0) return json({ error: "invalid_export_request" }, 400);
        } catch (error) {
          return bodyError(error);
        }

        const rateLimit = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "account_data_export",
          limit: 2,
          windowSeconds: 86_400,
        });
        if (!rateLimit.allowed) {
          return json(
            {
              error:
                rateLimit.status === "limited"
                  ? "account_export_rate_limited"
                  : "request_protection_unavailable",
            },
            rateLimit.status === "limited" ? 429 : 503,
            { "Retry-After": String(rateLimit.retryAfter) },
          );
        }

        const current = await latestJob(auth);
        if (current.error) return json({ error: "account_export_status_unavailable" }, 503);
        if (current.data && ["queued", "processing"].includes(String(current.data.status))) {
          return json({ job: publicAccountExportJob(current.data) }, 202);
        }

        const created = await adminFor(auth)
          .from("account_export_jobs")
          .insert({ user_id: auth.userId, status: "queued", format_version: 1 })
          .select(JOB_COLUMNS)
          .single();
        if (created.error || !created.data) {
          const conflict = created.error?.code === "23505";
          return json(
            { error: conflict ? "account_export_already_active" : "account_export_request_failed" },
            conflict ? 409 : 503,
          );
        }
        try {
          await writeAudit(auth, String(created.data.id), "Account data export requested");
        } catch {
          await adminFor(auth)
            .from("account_export_jobs")
            .update({ status: "failed", failure_code: "account_export_audit_failed" })
            .eq("id", created.data.id)
            .eq("user_id", auth.userId)
            .select("id")
            .maybeSingle();
          return json({ error: "account_export_request_failed" }, 503);
        }
        return json({ job: publicAccountExportJob(created.data) }, 202, {
          Location: "/api/account/export",
          "Retry-After": "5",
        });
      },

      DELETE: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return json({ error: "cross_site_account_change" }, 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: Record<string, unknown>;
        try {
          body = await readBoundedJsonObject(request, 512);
        } catch (error) {
          return bodyError(error);
        }
        if (Object.keys(body).length !== 1 || !isUuid(body.id)) {
          return json({ error: "invalid_export_cancel_request" }, 400);
        }
        const selected = await adminFor(auth)
          .from("account_export_jobs")
          .select(JOB_COLUMNS)
          .eq("id", body.id)
          .eq("user_id", auth.userId)
          .maybeSingle();
        if (selected.error) return json({ error: "account_export_status_unavailable" }, 503);
        if (!selected.data) return json({ error: "account_export_not_found" }, 404);
        const updated = await adminFor(auth)
          .from("account_export_jobs")
          .update({
            status: "canceled",
            storage_path: null,
            content_sha256: null,
            size_bytes: null,
            worker_id: null,
            lease_expires_at: null,
            expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", body.id)
          .eq("user_id", auth.userId)
          .select(JOB_COLUMNS)
          .maybeSingle();
        if (updated.error || !updated.data) {
          return json({ error: "account_export_cancel_failed" }, 503);
        }
        try {
          await clearAccountExportArtifacts(auth.userId, body.id);
        } catch {
          return json({ error: "account_export_delete_failed" }, 503);
        }
        await writeAudit(auth, body.id, "Account data export canceled").catch(() => undefined);
        return json({ job: publicAccountExportJob(updated.data) });
      },
    },
  },
});
