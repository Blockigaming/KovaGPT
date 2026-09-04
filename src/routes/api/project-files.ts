import { createFileRoute } from "@tanstack/react-router";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  enforceStorage,
  getCallerTier,
  requireUser,
  requireVerifiedUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { DAILY_UPLOAD_LIMIT_BY_TIER, STORAGE_LIMITS_BYTES } from "@/lib/modes";
import { PROJECT_LIMITS } from "@/lib/projects.functions";
import {
  inspectProjectFile,
  ProjectFileInputError,
  readProjectFileBody,
  sha256Hex,
} from "@/lib/project-files-policy.mjs";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETE_BODY_LIMIT = 1_024;

type ProjectFileRow = {
  id: string;
  project_id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  kind: "file" | "image";
  status: string;
  storage_charged: boolean;
  inProgress?: boolean;
};

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function inputError(error: unknown): Response {
  if (error instanceof ProjectFileInputError) {
    return json({ error: error.code }, error.status);
  }
  return json({ error: "invalid_project_file_request" }, 400);
}

function headerValue(request: Request, name: string, maxLength: number): string {
  const value = request.headers.get(name);
  if (!value || value.length > maxLength) {
    throw new ProjectFileInputError(400, `missing_or_invalid_${name}`);
  }
  return value;
}

function uploadMetadata(request: Request): {
  projectId: string;
  fileName: string;
  requestedKind: "file" | "image";
  idempotencyKey: string;
} {
  const projectId = headerValue(request, "x-kova-project-id", 36);
  const idempotencyKey = headerValue(request, "x-kova-idempotency-key", 36);
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(idempotencyKey)) {
    throw new ProjectFileInputError(400, "invalid_project_file_identity");
  }
  const encodedName = headerValue(request, "x-kova-file-name", 2_000);
  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
    throw new ProjectFileInputError(400, "invalid_file_name");
  }
  const requestedKind = request.headers.get("x-kova-file-kind") === "image" ? "image" : "file";
  return { projectId, fileName, requestedKind, idempotencyKey };
}

async function projectUploadAuthorization(
  auth: AuthedCaller,
  projectId: string,
): Promise<{ ownerId: string; fileCap: number } | Response> {
  const { data: membership, error: membershipError } = await auth.supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (membershipError) return json({ error: "project_authorization_unavailable" }, 503);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return json({ error: "project_not_found" }, 404);
  }

  const { data: project, error: projectError } = await auth.supabaseAdmin
    .from("projects")
    .select("owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return json({ error: "project_authorization_unavailable" }, 503);
  if (!project) return json({ error: "project_not_found" }, 404);

  const { data: ownerTier, error: tierError } = await auth.supabaseAdmin.rpc("user_plan_tier", {
    _user_id: project.owner_id,
  });
  if (tierError) return json({ error: "project_plan_unavailable" }, 503);
  const tier = ownerTier === "pro" || ownerTier === "plus" ? ownerTier : "free";
  return { ownerId: project.owner_id, fileCap: PROJECT_LIMITS[tier].filesPerProject };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reservationRow(value: unknown): ProjectFileRow | null {
  const row = record(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.storage_path !== "string" ||
    typeof row.mime_type !== "string" ||
    typeof row.size_bytes !== "number" ||
    (row.kind !== "file" && row.kind !== "image") ||
    typeof row.status !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    kind: row.kind,
    status: row.status,
    storage_charged: row.storage_charged === true,
    inProgress: row.inProgress === true,
  };
}

async function setUploadState(
  auth: AuthedCaller,
  fileId: string,
  attemptId: string,
  status: "pending" | "ready" | "upload_failed" | "cleanup_failed",
  storageCharged: boolean,
): Promise<boolean> {
  const { data, error } = await auth.supabaseAdmin
    .from("project_files")
    .update({
      status,
      storage_charged: storageCharged,
      upload_lease_until: status === "pending" ? new Date(Date.now() + 120_000).toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", fileId)
    .eq("upload_attempt_id", attemptId)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

async function releaseStorage(auth: AuthedCaller, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true;
  const { error } = await auth.supabaseAdmin.rpc(
    "release_project_storage_bytes" as never,
    { p_user_id: auth.userId, p_bytes: bytes } as never,
  );
  return !error;
}

function reservationFailure(error: { code?: string; message?: string } | null): Response {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501" || message.includes("project_editor_access_required")) {
    return json({ error: "project_not_found" }, 404);
  }
  if (code === "23505" || message.includes("idempotency_conflict")) {
    return json({ error: "project_file_idempotency_conflict" }, 409);
  }
  if (message.includes("project_file_limit_reached")) {
    return json({ error: "project_file_limit_reached" }, 409);
  }
  if (code === "22023") return json({ error: "invalid_project_file_request" }, 400);
  return json({ error: "project_file_reservation_unavailable" }, 503);
}

async function upload(request: Request): Promise<Response> {
  if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/octet-stream") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const auth = await requireVerifiedUser(request);
  if (auth instanceof Response) return auth;

  const banned = await assertNotBanned(auth);
  if (banned) return banned;
  const enabled = await assertFeatureEnabled(auth, "uploads");
  if (enabled) return enabled;
  const rate = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action: "project_file_upload",
    limit: 20,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return json(
      {
        error:
          rate.status === "limited"
            ? "project_file_upload_rate_limited"
            : "project_file_upload_protection_unavailable",
      },
      rate.status === "limited" ? 429 : 503,
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  let metadata;
  let bytes;
  let inspected;
  try {
    metadata = uploadMetadata(request);
    bytes = await readProjectFileBody(request);
    inspected = inspectProjectFile({
      bytes,
      fileName: metadata.fileName,
      requestedKind: metadata.requestedKind,
    });
  } catch (error) {
    return inputError(error);
  }

  const authorization = await projectUploadAuthorization(auth, metadata.projectId);
  if (authorization instanceof Response) return authorization;

  const digest = await sha256Hex(bytes);
  const attemptId = crypto.randomUUID();
  const { data: reservation, error: reservationError } = await auth.supabaseAdmin.rpc(
    "reserve_project_file_upload" as never,
    {
      p_user_id: auth.userId,
      p_project_id: metadata.projectId,
      p_name: inspected.name,
      p_mime_type: inspected.mimeType,
      p_size_bytes: bytes.byteLength,
      p_kind: inspected.kind,
      p_extension: inspected.extension,
      p_content_sha256: digest,
      p_idempotency_key: metadata.idempotencyKey,
      p_attempt_id: attemptId,
      p_file_cap: authorization.fileCap,
    } as never,
  );
  if (reservationError) return reservationFailure(reservationError);
  const row = reservationRow(reservation);
  if (!row || row.project_id !== metadata.projectId) {
    return json({ error: "project_file_reservation_invalid" }, 503);
  }
  const expectedPath = `${metadata.projectId}/${row.id}.${inspected.extension}`;
  if (row.storage_path !== expectedPath) {
    return json({ error: "project_file_reservation_invalid" }, 503);
  }
  if (row.status === "ready") return json({ file: row, idempotent: true });
  if (row.inProgress) {
    return json({ error: "project_file_upload_in_progress" }, 409, { "Retry-After": "2" });
  }

  const callerTier = await getCallerTier(auth);
  const quota = await enforceQuota(
    auth,
    "uploads",
    DAILY_UPLOAD_LIMIT_BY_TIER[callerTier],
  );
  if (quota) {
    await setUploadState(auth, row.id, attemptId, "upload_failed", row.storage_charged);
    return quota;
  }

  let storageCharged = row.storage_charged;
  if (!storageCharged) {
    const storage = await enforceStorage(auth, bytes.byteLength, STORAGE_LIMITS_BYTES[callerTier]);
    if (storage) {
      await setUploadState(auth, row.id, attemptId, "upload_failed", false);
      return storage;
    }
    storageCharged = bytes.byteLength > 0;
    if (!(await setUploadState(auth, row.id, attemptId, "pending", storageCharged))) {
      if (storageCharged) await releaseStorage(auth, bytes.byteLength);
      return json({ error: "project_file_reservation_lost" }, 409);
    }
  }

  const stored = await auth.supabaseAdmin.storage.from("project-files").upload(row.storage_path, bytes, {
    contentType: inspected.mimeType,
    upsert: true,
  });
  if (stored.error) {
    const released = !storageCharged || (await releaseStorage(auth, bytes.byteLength));
    await setUploadState(
      auth,
      row.id,
      attemptId,
      released ? "upload_failed" : "cleanup_failed",
      !released,
    );
    return json({ error: "project_file_storage_unavailable" }, 503, { "Retry-After": "30" });
  }

  if (!(await setUploadState(auth, row.id, attemptId, "ready", storageCharged))) {
    const removed = await auth.supabaseAdmin.storage.from("project-files").remove([row.storage_path]);
    const released =
      !storageCharged || (removed.error ? false : await releaseStorage(auth, bytes.byteLength));
    await setUploadState(
      auth,
      row.id,
      attemptId,
      released ? "upload_failed" : "cleanup_failed",
      !released,
    );
    return json({ error: "project_file_finalize_unavailable" }, 503, { "Retry-After": "30" });
  }

  if (inspected.kind === "file") {
    try {
      const { indexProjectFile, isTextIndexable } = await import("@/lib/project-rag.server");
      if (isTextIndexable(inspected.mimeType, inspected.name)) {
        await indexProjectFile({
          supabaseAdmin: auth.supabaseAdmin as never,
          project_id: metadata.projectId,
          file_id: row.id,
          storage_path: row.storage_path,
          name: inspected.name,
          mime_type: inspected.mimeType,
        });
      }
    } catch {
      // The durable upload remains valid when optional indexing is unavailable.
    }
  }

  await auth.supabaseAdmin.from("project_activity").insert({
    project_id: metadata.projectId,
    actor_id: auth.userId,
    kind: inspected.kind === "image" ? "image_added" : "file_added",
    summary: `Uploaded ${inspected.kind === "image" ? "image" : "file"} “${inspected.name}”`,
  });
  return json({ file: { ...row, status: "ready", storage_charged: storageCharged } }, 201);
}

function missingObject(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number | string } | null;
  return Number(value?.statusCode ?? value?.status) === 404;
}

async function remove(request: Request): Promise<Response> {
  if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const auth = await requireVerifiedUser(request);
  if (auth instanceof Response) return auth;

  let raw;
  try {
    raw = await readUtf8BodyBounded(request, DELETE_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyReadError) return json({ error: error.code }, error.status);
    return json({ error: "invalid_request_body" }, 400);
  }
  let fileId = "";
  try {
    const body = JSON.parse(raw) as { id?: unknown };
    fileId = typeof body.id === "string" ? body.id : "";
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!UUID_PATTERN.test(fileId)) return json({ error: "invalid_project_file_id" }, 400);

  const { data: file, error: fileError } = await auth.supabaseAdmin
    .from("project_files")
    .select("id,project_id,storage_path,name")
    .eq("id", fileId)
    .maybeSingle();
  if (fileError) return json({ error: "project_file_delete_unavailable" }, 503);
  if (!file) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  const { data: member, error: memberError } = await auth.supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", file.project_id)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (memberError) return json({ error: "project_authorization_unavailable" }, 503);
  if (!member || !["owner", "editor"].includes(member.role)) {
    return json({ error: "project_file_not_found" }, 404);
  }
  if (!file.storage_path.startsWith(`${file.project_id}/`)) {
    return json({ error: "project_file_path_invalid" }, 503);
  }

  const removed = await auth.supabaseAdmin.storage
    .from("project-files")
    .remove([file.storage_path]);
  if (removed.error && !missingObject(removed.error)) {
    return json({ error: "project_file_storage_delete_failed" }, 503, { "Retry-After": "30" });
  }

  const { data: result, error: finalizeError } = await auth.supabaseAdmin.rpc(
    "finalize_project_file_delete" as never,
    { p_user_id: auth.userId, p_file_id: file.id } as never,
  );
  if (finalizeError || record(result)?.deleted !== true) {
    return json({ error: "project_file_delete_finalize_failed" }, 503, { "Retry-After": "30" });
  }

  await auth.supabaseAdmin.from("project_activity").insert({
    project_id: file.project_id,
    actor_id: auth.userId,
    kind: "file_deleted",
    summary: `Removed “${file.name}”`,
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function sign(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const fileId = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(fileId)) return json({ error: "invalid_project_file_id" }, 400);

  const rate = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action: "project_file_sign",
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return json(
      {
        error:
          rate.status === "limited"
            ? "project_file_sign_rate_limited"
            : "project_file_sign_protection_unavailable",
      },
      rate.status === "limited" ? 429 : 503,
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  const { data: file, error } = await auth.supabaseUser
    .from("project_files")
    .select("id,storage_path,status")
    .eq("id", fileId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) return json({ error: "project_file_sign_unavailable" }, 503);
  if (!file) return json({ error: "project_file_not_found" }, 404);

  const { data: signed, error: signError } = await auth.supabaseUser.storage
    .from("project-files")
    .createSignedUrl(file.storage_path, 60);
  if (signError || !signed?.signedUrl) {
    return json({ error: "project_file_sign_unavailable" }, 503, { "Retry-After": "5" });
  }
  return json({ url: signed.signedUrl, expiresIn: 60 });
}

export const Route = createFileRoute("/api/project-files")({
  server: {
    handlers: {
      GET: ({ request }) => sign(request),
      POST: ({ request }) => upload(request),
      DELETE: ({ request }) => remove(request),
    },
  },
});
