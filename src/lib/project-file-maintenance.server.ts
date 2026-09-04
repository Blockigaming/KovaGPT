import {
  assertProjectStoragePath,
  isMissingStorageObjectError,
  PROJECT_FILES_BUCKET,
  ProjectDeletionError,
  purgeProjectUploadAttemptFolder,
  type ProjectStorageAdapter,
} from "./project-deletion-policy.mjs";

type RpcError = { code?: string; message?: string } | null;
type RpcResult = Promise<{ data: unknown; error: RpcError }>;
type DownloadResult = Promise<{ data: Blob | null; error: unknown }>;
type ProjectFileStorage = ProjectStorageAdapter & {
  download(path: string): DownloadResult;
};
export type ProjectFileMaintenanceClient = {
  rpc(name: string, args: Record<string, unknown>): RpcResult;
  storage: { from(bucket: string): ProjectFileStorage };
};

type CleanupClaim =
  | { state: "complete" }
  | {
      state: "claimed";
      cleanupKind: "upload" | "delete";
      id: string;
      projectId: string;
      storagePath: string;
      kind: "file" | "image" | "agent-deliverable";
    };

const MAX_STALE_ROWS_PER_PASS = 25;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function claim(value: unknown): CleanupClaim | null {
  const row = record(value);
  if (row?.state === "complete") return { state: "complete" };
  if (
    row?.state !== "claimed" ||
    (row.cleanupKind !== "upload" && row.cleanupKind !== "delete") ||
    typeof row.id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.storage_path !== "string" ||
    !["file", "image", "agent-deliverable"].includes(String(row.kind))
  ) {
    return null;
  }
  return {
    state: "claimed",
    cleanupKind: row.cleanupKind,
    id: row.id,
    projectId: row.project_id,
    storagePath: row.storage_path,
    kind: row.kind as "file" | "image" | "agent-deliverable",
  };
}

function maintenanceError(code: string, cause?: unknown): ProjectDeletionError {
  return new ProjectDeletionError(code, 503, 5, cause);
}

async function renewCleanup(
  client: ProjectFileMaintenanceClient,
  fileId: string,
  attemptId: string,
): Promise<void> {
  const { data, error } = await client.rpc("renew_stale_project_file_cleanup", {
    p_file_id: fileId,
    p_attempt_id: attemptId,
  });
  if (error || data !== true) throw maintenanceError("project_file_cleanup_lease_lost", error);
}

async function failCleanup(
  client: ProjectFileMaintenanceClient,
  fileId: string,
  attemptId: string,
): Promise<void> {
  try {
    await client.rpc("fail_stale_project_file_cleanup", {
      p_file_id: fileId,
      p_attempt_id: attemptId,
    });
  } catch {
    // The durable row and expiring lease remain recoverable by a later pass.
  }
}

export async function cleanupStaleProjectUploadObjects({
  client,
  projectId,
  fileId,
  onProgress = async () => undefined,
}: {
  client: ProjectFileMaintenanceClient;
  projectId: string;
  fileId: string;
  onProgress?: () => Promise<void> | void;
}): Promise<void> {
  await purgeProjectUploadAttemptFolder({
    storage: client.storage.from(PROJECT_FILES_BUCKET),
    projectId,
    fileId,
    onProgress: async () => onProgress(),
  });
}

async function objectPresence(
  storage: ProjectFileStorage,
  storagePath: string,
): Promise<"present" | "missing" | "unknown"> {
  const { data, error } = await storage.download(storagePath);
  if (!error && data) return "present";
  if (isMissingStorageObjectError(error)) return "missing";
  return "unknown";
}

async function removeCanonicalObject(
  client: ProjectFileMaintenanceClient,
  item: Extract<CleanupClaim, { state: "claimed" }>,
): Promise<void> {
  if (item.kind === "agent-deliverable") return;
  const path = assertProjectStoragePath(item.projectId, item.storagePath);
  const storage = client.storage.from(PROJECT_FILES_BUCKET);
  const removed = await storage.remove([path]);
  if (!removed.error || isMissingStorageObjectError(removed.error)) return;

  const presence = await objectPresence(storage, path);
  if (presence === "missing") return;
  throw maintenanceError(
    presence === "present"
      ? "project_file_cleanup_storage_remove_failed"
      : "project_file_cleanup_storage_reconciliation_failed",
    removed.error,
  );
}

async function finalizeCleanup(
  client: ProjectFileMaintenanceClient,
  fileId: string,
  attemptId: string,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await client.rpc("finalize_stale_project_file_cleanup", {
      p_file_id: fileId,
      p_attempt_id: attemptId,
    });
    if (!result.error && record(result.data)?.deleted === true) return;
    lastError = result.error ?? result.data;
  }
  throw maintenanceError("project_file_cleanup_finalize_failed", lastError);
}

export async function reconcileProjectFileLifecycle({
  client,
  userId,
  projectId,
  maxRows = MAX_STALE_ROWS_PER_PASS,
}: {
  client: ProjectFileMaintenanceClient;
  userId: string;
  projectId: string;
  maxRows?: number;
}): Promise<{ cleaned: number; complete: boolean }> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100) {
    throw new ProjectDeletionError("project_file_cleanup_configuration_invalid", 500);
  }

  let cleaned = 0;
  while (cleaned < maxRows) {
    const attemptId = crypto.randomUUID();
    const result = await client.rpc("claim_stale_project_file_cleanup", {
      p_user_id: userId,
      p_project_id: projectId,
      p_attempt_id: attemptId,
    });
    if (result.error) throw maintenanceError("project_file_cleanup_claim_failed", result.error);
    const item = claim(result.data);
    if (!item) throw maintenanceError("project_file_cleanup_claim_invalid");
    if (item.state === "complete") return { cleaned, complete: true };

    try {
      await cleanupStaleProjectUploadObjects({
        client,
        projectId: item.projectId,
        fileId: item.id,
        onProgress: () => renewCleanup(client, item.id, attemptId),
      });
      await renewCleanup(client, item.id, attemptId);
      await removeCanonicalObject(client, item);
      await finalizeCleanup(client, item.id, attemptId);
      cleaned += 1;
    } catch (error) {
      await failCleanup(client, item.id, attemptId);
      if (error instanceof ProjectDeletionError) throw error;
      throw maintenanceError("project_file_cleanup_failed", error);
    }
  }

  return { cleaned, complete: false };
}
