import type { AuthedCaller } from "@/lib/api-auth.server";
import {
  assertProjectStoragePath,
  isMissingStorageObjectError,
  PROJECT_FILES_BUCKET,
  ProjectDeletionError,
  projectDeletionPublicMessage,
  purgeProjectStorageFolder,
  type ProjectStorageAdapter,
} from "@/lib/project-deletion-policy.mjs";

import {
  resolveProjectStorageRows,
  claimProjectStorageSourceCleanup,
} from "./project-storage-references.server";

const METADATA_PAGE_SIZE = 500;

type ProjectDeletionAdmin = AuthedCaller["supabaseAdmin"];

type DeletionOutcome = {
  ok: true;
  alreadyDeleted: boolean;
  removedObjects: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function retryAfter(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 60)
    : fallback;
}

function claimError(error: { code?: string; message?: string } | null): ProjectDeletionError {
  if (error?.code === "42501" || error?.message?.includes("project_not_found")) {
    return new ProjectDeletionError("project_not_found", 404);
  }
  return new ProjectDeletionError("project_deletion_claim_failed");
}

async function verifyMetadataPaths(
  admin: ProjectDeletionAdmin,
  projectId: string,
  onPage: () => Promise<void>,
): Promise<string[]> {
  const promotedSources = new Set<string>();
  let start = 0;
  while (true) {
    const { data, error } = await admin
      .from("project_files")
      .select("id,project_id,uploaded_by,storage_path,kind")
      .eq("project_id", projectId)
      .order("id", { ascending: true })
      .range(start, start + METADATA_PAGE_SIZE - 1);
    if (error) throw new ProjectDeletionError("project_metadata_read_failed");
    const sources = await resolveProjectStorageRows(admin, data ?? []);
    for (const source of sources) {
      if (source.bucket === PROJECT_FILES_BUCKET && source.source === "promoted")
        promotedSources.add(source.path);
    }
    for (const row of data ?? []) {
      if (row.kind === "agent-deliverable") continue;
      if (row.kind !== "file" && row.kind !== "image") {
        throw new ProjectDeletionError("project_metadata_read_failed");
      }
      assertProjectStoragePath(projectId, row.storage_path);
    }
    await onPage();
    if (!data || data.length < METADATA_PAGE_SIZE) return [...promotedSources];
    start += METADATA_PAGE_SIZE;
  }
}

async function markDeletionFailed(
  admin: ProjectDeletionAdmin,
  userId: string,
  projectId: string,
  attemptId: string,
  code: string,
): Promise<void> {
  try {
    await admin.rpc("fail_project_deletion", {
      p_attempt_id: attemptId,
      p_error_code: /^[a-z0-9_]{1,80}$/.test(code) ? code : "project_storage_cleanup_failed",
      p_project_id: projectId,
      p_user_id: userId,
    });
  } catch {
    // Preserve the original cleanup error. A later retry can reclaim an expired
    // lease even when recording this diagnostic fails.
  }
}

async function renewDeletionLease(
  admin: ProjectDeletionAdmin,
  userId: string,
  projectId: string,
  attemptId: string,
): Promise<void> {
  const { data: renewed, error } = await admin.rpc("renew_project_deletion", {
    p_attempt_id: attemptId,
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (error || renewed !== true) {
    throw new ProjectDeletionError("project_deletion_lease_lost", 409, 2);
  }
}

export async function deleteProjectStorageFirst({
  admin,
  userId,
  projectId,
  deletingAccountUserId = null,
}: {
  admin: ProjectDeletionAdmin;
  userId: string;
  projectId: string;
  deletingAccountUserId?: string | null;
}): Promise<DeletionOutcome> {
  const attemptId = crypto.randomUUID();
  const { data: claimValue, error: claimFailure } = await admin.rpc("claim_project_deletion", {
    p_attempt_id: attemptId,
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (claimFailure) throw claimError(claimFailure);

  const claim = record(claimValue);
  const state = typeof claim?.state === "string" ? claim.state : "";
  const canonicalProjectId =
    typeof claim?.projectId === "string" ? claim.projectId : projectId.toLowerCase();

  if (state === "completed") {
    return { ok: true, alreadyDeleted: true, removedObjects: 0 };
  }
  if (state === "busy") {
    throw new ProjectDeletionError("project_deletion_busy", 409, retryAfter(claim?.retryAfter, 2));
  }
  if (state === "waiting_for_files") {
    throw new ProjectDeletionError(
      "project_file_operations_settling",
      409,
      retryAfter(claim?.retryAfter, 5),
    );
  }
  if (state !== "claimed" || canonicalProjectId !== projectId.toLowerCase()) {
    throw new ProjectDeletionError("project_deletion_claim_invalid");
  }

  try {
    const promotedSources = await verifyMetadataPaths(admin, canonicalProjectId, () =>
      renewDeletionLease(admin, userId, canonicalProjectId, attemptId),
    );
    const retainedPaths = new Set<string>();
    const retainSurvivingPaths = async (paths: string[]) => {
      const retained = await claimProjectStorageSourceCleanup(
        admin,
        canonicalProjectId,
        paths,
        [],
        deletingAccountUserId,
      );
      retained.forEach((path) => retainedPaths.add(path));
      return retained;
    };
    const storage = admin.storage.from(PROJECT_FILES_BUCKET) as unknown as ProjectStorageAdapter;
    const cleanup = await purgeProjectStorageFolder({
      storage,
      projectId: canonicalProjectId,
      protectedPaths: retainSurvivingPaths,
      onProgress: () => renewDeletionLease(admin, userId, canonicalProjectId, attemptId),
    });
    let promotedRemoved = 0;
    for (let start = 0; start < promotedSources.length; start += 100) {
      const paths = promotedSources
        .slice(start, start + 100)
        .filter((path) => !path.startsWith(`${canonicalProjectId}/`));
      const surviving = await retainSurvivingPaths(paths);
      const removable = paths.filter((path) => !surviving.has(path));
      if (removable.length > 0) {
        const result = await storage.remove(removable);
        if (result.error && !isMissingStorageObjectError(result.error))
          throw new ProjectDeletionError("project_storage_remove_failed");
        promotedRemoved += removable.length;
      }
      await renewDeletionLease(admin, userId, canonicalProjectId, attemptId);
    }
    await renewDeletionLease(admin, userId, canonicalProjectId, attemptId);

    const { data: finalizedValue, error: finalizeFailure } = await admin.rpc(
      "finalize_project_deletion",
      {
        p_attempt_id: attemptId,
        p_project_id: canonicalProjectId,
        p_user_id: userId,
        p_retained_paths: [...retainedPaths],
      },
    );
    const finalized = record(finalizedValue);
    if (finalizeFailure || (finalized?.deleted !== true && finalized?.completed !== true)) {
      throw new ProjectDeletionError("project_deletion_finalize_failed");
    }
    return {
      ok: true,
      alreadyDeleted: finalized.completed === true,
      removedObjects: cleanup.removedCount + promotedRemoved,
    };
  } catch (error) {
    const code =
      error instanceof ProjectDeletionError ? error.code : "project_storage_cleanup_failed";
    await markDeletionFailed(admin, userId, canonicalProjectId, attemptId, code);
    throw error instanceof ProjectDeletionError
      ? error
      : new ProjectDeletionError("project_storage_cleanup_failed");
  }
}

export async function deleteOwnedProjectsBeforeAccountDeletion({
  admin,
  userId,
}: {
  admin: ProjectDeletionAdmin;
  userId: string;
}): Promise<{ deletedProjects: number }> {
  const projectIds: string[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await admin
      .from("projects")
      .select("id")
      .eq("owner_id", userId)
      .order("id", { ascending: true })
      .range(start, start + METADATA_PAGE_SIZE - 1);
    if (error) throw new ProjectDeletionError("owned_projects_read_failed");
    for (const project of data ?? []) projectIds.push(project.id);
    if (!data || data.length < METADATA_PAGE_SIZE) break;
    start += METADATA_PAGE_SIZE;
  }

  let deletedProjects = 0;
  for (const projectId of projectIds) {
    await deleteProjectStorageFirst({ admin, userId, projectId, deletingAccountUserId: userId });
    deletedProjects += 1;
  }
  return { deletedProjects };
}

export { ProjectDeletionError, projectDeletionPublicMessage };
