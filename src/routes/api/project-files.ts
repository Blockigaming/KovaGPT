import { createFileRoute } from "@tanstack/react-router";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import {
  assertFeatureEnabled,
  assertNotBanned,
  getCallerTier,
  getUserTier,
  requireUser,
  requireVerifiedUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { DAILY_UPLOAD_LIMIT_BY_TIER, STORAGE_LIMITS_BYTES } from "@/lib/modes";
import { PROJECT_LIMITS } from "@/lib/projects.functions";
import {
  inspectProjectFile,
  normalizeProjectFileIdentity,
  ProjectFileInputError,
  readProjectFileBody,
  sha256Hex,
} from "@/lib/project-files-policy.mjs";
import {
  cleanupStaleProjectUploadObjects,
  reconcileProjectFileLifecycle,
  type ProjectFileMaintenanceClient,
} from "@/lib/project-file-maintenance.server";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import {
  reserveAccountStorageArtifact,
  retireAccountStorageArtifact,
} from "@/lib/account-storage-artifacts.server";

import {
  projectFileStorageReference,
  claimProjectStorageSourceCleanup,
} from "@/lib/project-storage-references.server";

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
  storage_owner_id: string | null;
  upload_quota_acquired: boolean;
  reservationCreated?: boolean;
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
  const projectId = normalizeProjectFileIdentity(headerValue(request, "x-kova-project-id", 36));
  const idempotencyKey = normalizeProjectFileIdentity(
    headerValue(request, "x-kova-idempotency-key", 36),
  );
  const encodedName = headerValue(request, "x-kova-file-name", 2_000);
  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
    throw new ProjectFileInputError(400, "invalid_file_name");
  }
  const requestedKind = request.headers.get("x-kova-file-kind") === "image" ? "image" : "file";
  return {
    projectId,
    fileName,
    requestedKind,
    idempotencyKey,
  };
}

async function projectUploadAuthorization(
  auth: AuthedCaller,
  projectId: string,
): Promise<{ ownerId: string; fileCap: number; storageLimit: number } | Response> {
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
    .select("owner_id,deletion_requested_at")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return json({ error: "project_authorization_unavailable" }, 503);
  if (!project) return json({ error: "project_not_found" }, 404);
  if (project.deletion_requested_at) {
    return json({ error: "project_deletion_pending" }, 409, { "Retry-After": "5" });
  }

  const tier = await getUserTier(auth, project.owner_id);
  return {
    ownerId: project.owner_id,
    fileCap: PROJECT_LIMITS[tier].filesPerProject,
    storageLimit: STORAGE_LIMITS_BYTES[tier],
  };
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
    storage_owner_id: typeof row.storage_owner_id === "string" ? row.storage_owner_id : null,
    upload_quota_acquired: row.upload_quota_acquired === true,
    reservationCreated: row.reservationCreated === true,
    inProgress: row.inProgress === true,
  };
}

async function setUploadState(
  auth: AuthedCaller,
  fileId: string,
  attemptId: string,
  status: "pending" | "ready" | "upload_failed" | "cleanup_failed",
): Promise<boolean> {
  const { data, error } = await auth.supabaseAdmin.rpc(
    "set_project_file_upload_state" as never,
    {
      p_file_id: fileId,
      p_attempt_id: attemptId,
      p_status: status,
    } as never,
  );
  return !error && data === true;
}

async function abortProjectFileUpload(
  auth: AuthedCaller,
  fileId: string,
  attemptId: string,
): Promise<boolean> {
  const { data, error } = await auth.supabaseAdmin.rpc(
    "abort_project_file_upload" as never,
    { p_file_id: fileId, p_attempt_id: attemptId } as never,
  );
  return !error && record(data)?.aborted === true;
}

async function projectFileObjectPresence(
  auth: AuthedCaller,
  storagePath: string,
): Promise<"present" | "missing" | "unknown"> {
  const { data, error } = await auth.supabaseAdmin.storage
    .from("project-files")
    .download(storagePath);
  if (!error && data) return "present";
  if (missingObject(error)) return "missing";
  return "unknown";
}

function projectFileDeleteClaim(value: unknown): {
  claimed: boolean;
  inProgress: boolean;
  id?: string;
  projectId?: string;
  storagePath?: string;
  name?: string;
  kind?: "file" | "image" | "agent-deliverable";
} | null {
  const row = record(value);
  if (!row || typeof row.claimed !== "boolean") return null;
  if (!row.claimed) {
    return { claimed: false, inProgress: row.inProgress === true };
  }
  if (
    typeof row.id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.storage_path !== "string" ||
    typeof row.name !== "string" ||
    !["file", "image", "agent-deliverable"].includes(String(row.kind))
  ) {
    return null;
  }
  return {
    claimed: true,
    inProgress: false,
    id: row.id,
    projectId: row.project_id,
    storagePath: row.storage_path,
    name: row.name,
    kind: row.kind as "file" | "image" | "agent-deliverable",
  };
}

async function restoreProjectFileDelete(
  auth: AuthedCaller,
  fileId: string,
  attemptId: string,
): Promise<boolean> {
  const { data, error } = await auth.supabaseAdmin.rpc(
    "restore_project_file_delete" as never,
    { p_file_id: fileId, p_attempt_id: attemptId } as never,
  );
  return !error && data === true;
}

async function acquireUploadQuota(
  auth: AuthedCaller,
  row: ProjectFileRow,
  attemptId: string,
  dailyLimit: number,
): Promise<{ acquired: boolean; limitReached: boolean; lost: boolean } | null> {
  const { data, error } = await auth.supabaseAdmin.rpc(
    "acquire_project_file_upload_quota" as never,
    {
      p_user_id: auth.userId,
      p_file_id: row.id,
      p_attempt_id: attemptId,
      p_daily_limit: dailyLimit,
    } as never,
  );
  if (!error) {
    const result = record(data);
    if (result && typeof result.acquired === "boolean") {
      return {
        acquired: result.acquired,
        limitReached: result.limitReached === true,
        lost: result.lost === true,
      };
    }
    return null;
  }

  // The RPC response may be lost after its transaction commits. Reconcile the
  // durable marker before deciding whether a retry would double-charge quota.
  const current = await auth.supabaseAdmin
    .from("project_files")
    .select("status,upload_attempt_id,upload_quota_acquired")
    .eq("id", row.id)
    .maybeSingle();
  if (
    !current.error &&
    current.data?.status === "pending" &&
    current.data.upload_attempt_id === attemptId &&
    current.data.upload_quota_acquired === true
  ) {
    return { acquired: true, limitReached: false, lost: false };
  }
  return null;
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
  if (message.includes("project_storage_limit_reached")) {
    return json({ error: "project_storage_limit_reached" }, 413);
  }
  if (message.includes("project_file_delete_pending")) {
    return json({ error: "project_file_delete_in_progress" }, 409, { "Retry-After": "2" });
  }
  if (message.includes("project_deletion_pending")) {
    return json({ error: "project_deletion_pending" }, 409, { "Retry-After": "5" });
  }
  if (code === "22023") return json({ error: "invalid_project_file_request" }, 400);
  return json({ error: "project_file_reservation_unavailable" }, 503);
}

async function upload(request: Request): Promise<Response> {
  if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/octet-stream"
  ) {
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
  try {
    metadata = uploadMetadata(request);
    bytes = await readProjectFileBody(request);
  } catch (error) {
    return inputError(error);
  }

  return publishProjectFileBytes(auth, metadata, bytes);
}

/** Shared by authenticated uploads and verified Work output publication. */
export async function publishProjectFileBytes(
  auth: AuthedCaller,
  metadata: {
    projectId: string;
    fileName: string;
    requestedKind: "file" | "image";
    idempotencyKey: string;
  },
  bytes: Uint8Array,
  verifyStoredDigest = false,
  publishReady?: (fileId: string, attemptId: string) => Promise<boolean>,
): Promise<Response> {
  const banned = await assertNotBanned(auth);
  if (banned) return banned;
  const enabled = await assertFeatureEnabled(auth, "uploads");
  if (enabled) return enabled;
  let inspected;
  try {
    normalizeProjectFileIdentity(metadata.projectId);
    normalizeProjectFileIdentity(metadata.idempotencyKey);
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

  try {
    const maintenance = await reconcileProjectFileLifecycle({
      client: auth.supabaseAdmin as unknown as ProjectFileMaintenanceClient,
      userId: auth.userId,
      projectId: metadata.projectId,
    });
    if (!maintenance.complete) {
      return json({ error: "project_file_cleanup_incomplete" }, 503, { "Retry-After": "5" });
    }
  } catch {
    return json({ error: "project_file_cleanup_incomplete" }, 503, { "Retry-After": "5" });
  }

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
      p_storage_limit: authorization.storageLimit,
    } as never,
  );
  if (reservationError) return reservationFailure(reservationError);
  const row = reservationRow(reservation);
  if (
    !row ||
    row.project_id !== metadata.projectId ||
    row.storage_owner_id !== authorization.ownerId ||
    row.storage_charged !== bytes.byteLength > 0
  ) {
    return json({ error: "project_file_reservation_invalid" }, 503);
  }
  if (row.status === "ready") {
    if (verifyStoredDigest) {
      const existing = await auth.supabaseAdmin.storage
        .from("project-files")
        .download(row.storage_path);
      if (
        existing.error ||
        !existing.data ||
        existing.data.size !== bytes.byteLength ||
        (await sha256Hex(new Uint8Array(await existing.data.arrayBuffer()))) !== digest
      )
        return json({ error: "project_file_storage_verification_failed" }, 503);
    }
    return json({ file: row, idempotent: true });
  }
  if (row.inProgress) {
    return json({ error: "project_file_upload_in_progress" }, 409, { "Retry-After": "2" });
  }
  const expectedPath = `${metadata.projectId}/${attemptId}.${inspected.extension}`;
  if (row.storage_path !== expectedPath) {
    return json({ error: "project_file_reservation_invalid" }, 503);
  }

  if (
    !row.reservationCreated &&
    !(await cleanupStaleProjectUploadObjects({
      client: auth.supabaseAdmin as unknown as ProjectFileMaintenanceClient,
      projectId: metadata.projectId,
      fileId: row.id,
    })
      .then(() => true)
      .catch(() => false))
  ) {
    await setUploadState(auth, row.id, attemptId, "cleanup_failed");
    return json({ error: "project_file_stale_upload_cleanup_failed" }, 503, {
      "Retry-After": "30",
    });
  }

  let uploadQuotaAcquired = row.upload_quota_acquired;
  if (!uploadQuotaAcquired) {
    const callerTier = await getCallerTier(auth);
    const quota = await acquireUploadQuota(
      auth,
      row,
      attemptId,
      DAILY_UPLOAD_LIMIT_BY_TIER[callerTier],
    );
    if (!quota) {
      if (!(await abortProjectFileUpload(auth, row.id, attemptId))) {
        return json({ error: "project_file_quota_recovery_failed" }, 503, {
          "Retry-After": "5",
        });
      }
      return json({ error: "project_file_quota_unavailable" }, 503, {
        "Retry-After": "5",
      });
    }
    if (quota.lost) {
      return json({ error: "project_file_reservation_lost" }, 409, {
        "Retry-After": "2",
      });
    }
    if (quota.limitReached) {
      if (!(await abortProjectFileUpload(auth, row.id, attemptId))) {
        return json({ error: "project_file_quota_recovery_failed" }, 503, {
          "Retry-After": "5",
        });
      }
      return json({ error: "project_file_daily_limit_reached" }, 429, {
        "Retry-After": "3600",
      });
    }
    if (!quota.acquired) {
      return json({ error: "project_file_quota_unavailable" }, 503, {
        "Retry-After": "5",
      });
    }
    uploadQuotaAcquired = true;
  }

  // Every attempt owns a unique immutable path. A delayed upload can only
  // recreate its own retired generation, which the durable sweeper can remove.
  const artifact = {
    generation: attemptId,
    ownerId: authorization.ownerId,
    requesterId: auth.userId,
    bucket: "project-files" as const,
    path: row.storage_path,
  };
  try {
    await reserveAccountStorageArtifact(artifact);
  } catch {
    await abortProjectFileUpload(auth, row.id, attemptId);
    return json({ error: "project_file_account_cleanup_pending" }, 409, { "Retry-After": "5" });
  }
  let published = false;
  try {
    const stored = await auth.supabaseAdmin.storage
      .from("project-files")
      .upload(row.storage_path, bytes, { contentType: inspected.mimeType, upsert: false });
    if (stored.error) {
      await setUploadState(auth, row.id, attemptId, "cleanup_failed");
      return json({ error: "project_file_storage_unavailable" }, 503, { "Retry-After": "30" });
    }
    if (verifyStoredDigest) {
      const verification = await auth.supabaseAdmin.storage
        .from("project-files")
        .download(row.storage_path);
      if (
        verification.error ||
        !verification.data ||
        verification.data.size !== bytes.byteLength ||
        (await sha256Hex(new Uint8Array(await verification.data.arrayBuffer()))) !== digest
      ) {
        await setUploadState(auth, row.id, attemptId, "cleanup_failed");
        return json({ error: "project_file_storage_verification_failed" }, 503);
      }
    }
    // The ready-state transaction settles the generation under the same
    // account-deletion lock; a fenced or retired attempt cannot publish.
    published = publishReady
      ? await publishReady(row.id, attemptId)
      : await setUploadState(auth, row.id, attemptId, "ready");
    if (!published) {
      const { data: current } = await auth.supabaseAdmin
        .from("project_files")
        .select("status,content_sha256,storage_path")
        .eq("id", row.id)
        .maybeSingle();
      published =
        current?.status === "ready" &&
        current.content_sha256 === digest &&
        current.storage_path === row.storage_path;
      if (!published)
        return json({ error: "project_file_finalize_unavailable" }, 503, { "Retry-After": "5" });
    }
  } finally {
    if (!published) {
      // Failure to reach this best-effort action is recoverable from the
      // durable reservation and its expiring producer lease.
      await retireAccountStorageArtifact(artifact).catch(() => undefined);
    }
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
  return json(
    {
      file: {
        ...row,
        status: "ready",
        storage_charged: row.storage_charged,
        upload_quota_acquired: uploadQuotaAcquired,
      },
    },
    201,
  );
}

function missingObject(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number | string } | null;
  return Number(value?.statusCode ?? value?.status) === 404;
}

async function remove(request: Request): Promise<Response> {
  if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const rate = await consumeApplicationRateLimit({
    identity: `user:${auth.userId}`,
    action: "project_file_delete",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return json(
      {
        error:
          rate.status === "limited"
            ? "project_file_delete_rate_limited"
            : "project_file_delete_protection_unavailable",
      },
      rate.status === "limited" ? 429 : 503,
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  let raw;
  try {
    raw = await readUtf8BodyBounded(request, DELETE_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyReadError) return json({ error: error.code }, error.status);
    return json({ error: "invalid_request_body" }, 400);
  }
  let fileId: string;
  try {
    const body = JSON.parse(raw) as { id?: unknown };
    fileId = typeof body.id === "string" ? body.id : "";
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!UUID_PATTERN.test(fileId)) return json({ error: "invalid_project_file_id" }, 400);

  const attemptId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await auth.supabaseAdmin.rpc(
    "claim_project_file_delete" as never,
    {
      p_user_id: auth.userId,
      p_file_id: fileId,
      p_attempt_id: attemptId,
    } as never,
  );
  if (claimError) {
    if (claimError.message.includes("project_deletion_pending")) {
      return json({ error: "project_deletion_pending" }, 409, { "Retry-After": "5" });
    }
    return json({ error: "project_file_delete_unavailable" }, 503);
  }
  const file = projectFileDeleteClaim(claimed);
  if (!file) return json({ error: "project_file_delete_unavailable" }, 503);
  if (!file.claimed) {
    if (file.inProgress) {
      return json({ error: "project_file_delete_in_progress" }, 409, { "Retry-After": "2" });
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (
    !file.id ||
    !file.projectId ||
    !file.storagePath ||
    !file.name ||
    !file.kind ||
    (file.kind !== "agent-deliverable" && !file.storagePath.startsWith(`${file.projectId}/`))
  ) {
    await restoreProjectFileDelete(auth, fileId, attemptId);
    return json({ error: "project_file_path_invalid" }, 503);
  }

  const source = await projectFileStorageReference(auth.supabaseAdmin, file.id);
  const surviving =
    source.bucket === "project-files"
      ? await claimProjectStorageSourceCleanup(auth.supabaseAdmin, null, [source.path], [file.id])
      : new Set<string>();
  if (source.bucket === "project-files" && !surviving.has(source.path)) {
    const removed = await auth.supabaseAdmin.storage
      .from("project-files")
      .remove([file.storagePath]);
    if (removed.error && !missingObject(removed.error)) {
      const presence = await projectFileObjectPresence(auth, file.storagePath);
      if (presence === "unknown") {
        return json({ error: "project_file_delete_reconciliation_failed" }, 503, {
          "Retry-After": "30",
        });
      }
      if (presence === "present") {
        // Source retirement is durable: keep this row deleting for retry.
        // Restoring it could admit a reference after an ambiguous remove.
        return json({ error: "project_file_storage_delete_failed" }, 503, {
          "Retry-After": "30",
        });
      }
    }
  }

  const finalize = () =>
    auth.supabaseAdmin.rpc(
      "finalize_project_file_delete" as never,
      {
        p_file_id: file.id,
        p_attempt_id: attemptId,
        p_storage_removed: source.bucket === "project-files" && !surviving.has(source.path),
      } as never,
    );
  let finalized = await finalize();
  if (finalized.error) finalized = await finalize();
  if (finalized.error || record(finalized.data)?.deleted !== true) {
    return json({ error: "project_file_delete_finalize_failed" }, 503, {
      "Retry-After": "5",
    });
  }

  await auth.supabaseAdmin.from("project_activity").insert({
    project_id: file.projectId,
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
