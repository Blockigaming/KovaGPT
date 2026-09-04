export const PROJECT_FILES_BUCKET: "project-files";
export const PROJECT_STORAGE_DELETE_BATCH: number;
export const PROJECT_STORAGE_MAX_OBJECTS_PER_ATTEMPT: number;
export const PROJECT_STORAGE_MAX_FOLDER_DEPTH: number;
export const PROJECT_UPLOAD_CLEANUP_MAX_OBJECTS: number;

export class ProjectDeletionError extends Error {
  code: string;
  status: number;
  retryAfter: number | null;
  constructor(code: string, status?: number, retryAfter?: number | null, cause?: unknown);
}

export function normalizeProjectDeletionId(value: unknown): string;
export function projectStorageFolder(projectId: string): string;
export function assertProjectStoragePath(projectId: string, storagePath: unknown): string;
export function joinListedProjectStorageChild(
  projectId: string,
  folder: unknown,
  childName: unknown,
): string;
export function isMissingStorageObjectError(error: unknown): boolean;

export type ProjectStorageListItem = { id: string | null; name: string };
export type ProjectStorageAdapter = {
  list(
    folder: string,
    options: {
      limit: number;
      offset: number;
      sortBy: { column: "name"; order: "asc" };
    },
  ): Promise<{ data: ProjectStorageListItem[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
};

export function purgeProjectStorageFolder(options: {
  storage: ProjectStorageAdapter;
  projectId: string;
  maxObjects?: number;
  maxFolderDepth?: number;
  onProgress?: (progress: {
    removedCount: number;
    folder: string;
    paths: string[];
  }) => Promise<void> | void;
}): Promise<{ complete: true; removedCount: number }>;

export function projectUploadAttemptFolder(projectId: string, fileId: string): string;
export function purgeProjectUploadAttemptFolder(options: {
  storage: ProjectStorageAdapter;
  projectId: string;
  fileId: string;
  maxObjects?: number;
  onProgress?: (progress: {
    removedCount: number;
    folder: string;
    paths: string[];
  }) => Promise<void> | void;
}): Promise<{ complete: true; removedCount: number }>;

export function projectDeletionPublicMessage(error: unknown): string;
