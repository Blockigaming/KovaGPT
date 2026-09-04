export const PROJECT_FILES_BUCKET = "project-files";
export const PROJECT_STORAGE_DELETE_BATCH = 100;
export const PROJECT_STORAGE_MAX_OBJECTS_PER_ATTEMPT = 2_000;
export const PROJECT_STORAGE_MAX_FOLDER_DEPTH = 16;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_SEGMENT_PATTERN = /[\\/\u0000-\u001f\u007f]/u;

export class ProjectDeletionError extends Error {
  constructor(code, status = 503, retryAfter = null, cause = undefined) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "ProjectDeletionError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function normalizeProjectDeletionId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ProjectDeletionError("invalid_project_id", 400);
  }
  return value.toLowerCase();
}

export function projectStorageFolder(projectId) {
  return normalizeProjectDeletionId(projectId);
}

export function assertProjectStoragePath(projectId, storagePath) {
  const root = projectStorageFolder(projectId);
  const prefix = `${root}/`;
  if (
    typeof storagePath !== "string" ||
    storagePath.length <= prefix.length ||
    storagePath.length > 1_024 ||
    !storagePath.startsWith(prefix)
  ) {
    throw new ProjectDeletionError("project_file_path_invalid", 409);
  }
  for (const segment of storagePath.slice(prefix.length).split("/")) {
    if (!segment || segment === "." || segment === ".." || UNSAFE_SEGMENT_PATTERN.test(segment)) {
      throw new ProjectDeletionError("project_file_path_invalid", 409);
    }
  }
  return storagePath;
}

export function joinListedProjectStorageChild(projectId, folder, childName) {
  const root = projectStorageFolder(projectId);
  if (
    typeof folder !== "string" ||
    (folder !== root && !folder.startsWith(`${root}/`)) ||
    folder.endsWith("/") ||
    typeof childName !== "string" ||
    !childName ||
    childName === "." ||
    childName === ".." ||
    childName.length > 512 ||
    UNSAFE_SEGMENT_PATTERN.test(childName)
  ) {
    throw new ProjectDeletionError("project_storage_listing_invalid", 503);
  }
  return assertProjectStoragePath(root, `${folder}/${childName}`);
}

export function isMissingStorageObjectError(error) {
  if (!error || typeof error !== "object") return false;
  const value = error;
  const status = Number(value.statusCode ?? value.status);
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  return (
    status === 404 ||
    code === "404" ||
    code === "not_found" ||
    code === "nosuchkey" ||
    code === "no_such_key"
  );
}

function storageResult(value, failureCode) {
  if (!value || typeof value !== "object") {
    throw new ProjectDeletionError(failureCode);
  }
  return value;
}

export async function purgeProjectStorageFolder({
  storage,
  projectId,
  maxObjects = PROJECT_STORAGE_MAX_OBJECTS_PER_ATTEMPT,
  maxFolderDepth = PROJECT_STORAGE_MAX_FOLDER_DEPTH,
  onProgress = async () => undefined,
}) {
  if (
    !storage ||
    typeof storage.list !== "function" ||
    typeof storage.remove !== "function" ||
    !Number.isSafeInteger(maxObjects) ||
    maxObjects < 1 ||
    !Number.isSafeInteger(maxFolderDepth) ||
    maxFolderDepth < 1
  ) {
    throw new ProjectDeletionError("project_storage_cleanup_configuration_invalid", 500);
  }

  const root = projectStorageFolder(projectId);
  let removedCount = 0;
  let scanCount = 0;
  const maxScans = Math.max(32, maxObjects * 4);

  async function purgeFolder(folder, depth) {
    if (depth > maxFolderDepth) {
      throw new ProjectDeletionError("project_storage_folder_depth_exceeded", 409);
    }

    let folderOnlyRounds = 0;
    while (true) {
      scanCount += 1;
      if (scanCount > maxScans) {
        throw new ProjectDeletionError("project_storage_cleanup_incomplete", 503, 2);
      }

      const remaining = maxObjects - removedCount;
      const listed = storageResult(
        await storage.list(folder, {
          limit: remaining > 0 ? Math.min(PROJECT_STORAGE_DELETE_BATCH, remaining) : 1,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        }),
        "project_storage_list_failed",
      );
      if (listed.error) {
        throw new ProjectDeletionError("project_storage_list_failed");
      }
      if (!Array.isArray(listed.data)) {
        throw new ProjectDeletionError("project_storage_listing_invalid");
      }
      if (listed.data.length === 0) return;
      if (remaining <= 0) {
        throw new ProjectDeletionError("project_storage_cleanup_incomplete", 503, 2);
      }

      const files = [];
      const folders = [];
      for (const item of listed.data) {
        if (!item || typeof item !== "object" || typeof item.name !== "string") {
          throw new ProjectDeletionError("project_storage_listing_invalid");
        }
        const path = joinListedProjectStorageChild(root, folder, item.name);
        if (item.id === null) folders.push(path);
        else if (typeof item.id === "string" && item.id) files.push(path);
        else throw new ProjectDeletionError("project_storage_listing_invalid");
      }

      for (const nestedFolder of folders) {
        await purgeFolder(nestedFolder, depth + 1);
      }

      if (files.length > 0) {
        const removed = storageResult(await storage.remove(files), "project_storage_remove_failed");
        if (removed.error && !isMissingStorageObjectError(removed.error)) {
          throw new ProjectDeletionError("project_storage_remove_failed");
        }
        removedCount += files.length;
        folderOnlyRounds = 0;
        await onProgress({ removedCount, folder, paths: [...files] });
      } else {
        folderOnlyRounds += 1;
        if (folderOnlyRounds > 1) {
          throw new ProjectDeletionError("project_storage_tree_stalled", 503, 2);
        }
      }
    }
  }

  await purgeFolder(root, 0);
  return { complete: true, removedCount };
}

export const PROJECT_UPLOAD_CLEANUP_MAX_OBJECTS = 2_000;

export function projectUploadAttemptFolder(projectId, fileId) {
  return `${projectStorageFolder(projectId)}/.uploads/${normalizeProjectDeletionId(fileId)}`;
}

export async function purgeProjectUploadAttemptFolder({
  storage,
  projectId,
  fileId,
  maxObjects = PROJECT_UPLOAD_CLEANUP_MAX_OBJECTS,
  onProgress = async () => undefined,
}) {
  if (
    !storage ||
    typeof storage.list !== "function" ||
    typeof storage.remove !== "function" ||
    !Number.isSafeInteger(maxObjects) ||
    maxObjects < 1
  ) {
    throw new ProjectDeletionError("project_upload_cleanup_configuration_invalid", 500);
  }

  const folder = projectUploadAttemptFolder(projectId, fileId);
  let removedCount = 0;
  let scans = 0;
  const maxScans = Math.max(4, Math.ceil(maxObjects / PROJECT_STORAGE_DELETE_BATCH) + 2);

  while (true) {
    scans += 1;
    if (scans > maxScans) {
      throw new ProjectDeletionError("project_upload_cleanup_incomplete", 503, 5);
    }

    const remaining = maxObjects - removedCount;
    const listed = storageResult(
      await storage.list(folder, {
        limit: remaining > 0 ? Math.min(PROJECT_STORAGE_DELETE_BATCH, remaining) : 1,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      }),
      "project_upload_cleanup_list_failed",
    );
    if (listed.error) {
      throw new ProjectDeletionError("project_upload_cleanup_list_failed");
    }
    if (!Array.isArray(listed.data)) {
      throw new ProjectDeletionError("project_upload_cleanup_listing_invalid");
    }
    if (listed.data.length === 0) return { complete: true, removedCount };
    if (remaining <= 0 || listed.data.length > remaining) {
      throw new ProjectDeletionError("project_upload_cleanup_incomplete", 503, 5);
    }

    const paths = listed.data.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.name !== "string" ||
        typeof item.id !== "string" ||
        !item.id
      ) {
        throw new ProjectDeletionError("project_upload_cleanup_listing_invalid");
      }
      return joinListedProjectStorageChild(projectId, folder, item.name);
    });

    const removed = storageResult(
      await storage.remove(paths),
      "project_upload_cleanup_remove_failed",
    );
    if (removed.error && !isMissingStorageObjectError(removed.error)) {
      throw new ProjectDeletionError("project_upload_cleanup_remove_failed");
    }
    removedCount += paths.length;
    await onProgress({ removedCount, folder, paths: [...paths] });
  }
}

export function projectDeletionPublicMessage(error) {
  const code =
    error instanceof ProjectDeletionError
      ? error.code
      : error && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : "";
  if (code === "project_not_found") return "Project not found.";
  if (code === "project_deletion_busy" || code === "project_file_operations_settling") {
    return "Project cleanup is already running or waiting for a file operation to finish. Try again shortly.";
  }
  if (code === "project_file_path_invalid") {
    return "Project deletion stopped because stored file metadata is inconsistent. No project record was removed.";
  }
  return "Deletion is incomplete. KovaGPT kept the project record so cleanup can safely resume. Try again.";
}
