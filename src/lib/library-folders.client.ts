import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";

export type LibraryFolder = {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type JsonObject = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class LibraryFolderRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(libraryFolderErrorMessage(code, status));
    this.name = "LibraryFolderRequestError";
    this.code = code;
    this.status = status;
  }
}

function libraryFolderErrorMessage(code: string, status: number): string {
  if (status === 401) return "Your session expired. Sign in again and retry.";
  if (status === 409 || code === "library_folder_name_conflict") {
    return "A folder with that name already exists here.";
  }
  if (status === 429) {
    return "Too many Library changes. Wait a moment and retry.";
  }
  if (code === "library_folder_not_found") {
    return "That folder no longer exists.";
  }
  if (code === "library_item_or_folder_not_found") {
    return "Some selected items or the destination folder no longer exist. Refresh and retry.";
  }
  if (code === "invalid_folder_name") {
    return "Use a folder name between 1 and 120 characters without slashes.";
  }
  if (status === 503) {
    return "Library organization is temporarily unavailable. Retry shortly.";
  }
  return "The Library change could not be completed. Please try again.";
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function folderValue(value: unknown): LibraryFolder | null {
  const row = objectValue(value);
  if (!row || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
    return null;
  }
  const parent = row.parentId ?? row.parent_id ?? null;
  if (parent !== null && (typeof parent !== "string" || !UUID_PATTERN.test(parent))) {
    return null;
  }
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  const position =
    typeof row.position === "number" && Number.isInteger(row.position) ? row.position : 0;
  const createdAt = row.createdAt ?? row.created_at;
  const updatedAt = row.updatedAt ?? row.updated_at;
  return {
    id: row.id.toLowerCase(),
    parentId: typeof parent === "string" ? parent.toLowerCase() : null,
    name: row.name,
    position,
    createdAt: typeof createdAt === "string" ? createdAt : "",
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
  };
}

async function responseObject(response: Response): Promise<JsonObject> {
  const payload = objectValue(await response.json().catch(() => null));
  if (!response.ok) {
    const code = typeof payload?.error === "string" ? payload.error : "library_request_failed";
    throw new LibraryFolderRequestError(code, response.status);
  }
  if (!payload) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return payload;
}

async function libraryRequest(
  method: string,
  path: string,
  body?: JsonObject,
): Promise<JsonObject> {
  const response = await fetchWithTimeoutAuthenticated(
    path,
    {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    15_000,
  );
  return responseObject(response);
}

export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  const payload = await libraryRequest("GET", "/api/library/folders");
  if (!Array.isArray(payload.folders)) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  const folders = payload.folders.map(folderValue);
  if (folders.some((folder) => folder === null)) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return folders as LibraryFolder[];
}

export async function createLibraryFolder(input: {
  name: string;
  parentId: string | null;
}): Promise<LibraryFolder> {
  const payload = await libraryRequest("POST", "/api/library/folders", input);
  const folder = folderValue(payload.folder);
  if (!folder) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return folder;
}

export async function renameLibraryFolder(input: {
  id: string;
  name: string;
}): Promise<LibraryFolder> {
  const payload = await libraryRequest("PATCH", "/api/library/folders", input);
  const folder = folderValue(payload.folder);
  if (!folder) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return folder;
}

export async function deleteLibraryFolder(
  id: string,
): Promise<{ deletedFolderCount: number; movedToRootCount: number }> {
  const payload = await libraryRequest("DELETE", "/api/library/folders", { id });
  if (
    typeof payload.deletedFolderCount !== "number" ||
    !Number.isInteger(payload.deletedFolderCount) ||
    typeof payload.movedToRootCount !== "number" ||
    !Number.isInteger(payload.movedToRootCount)
  ) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return {
    deletedFolderCount: payload.deletedFolderCount,
    movedToRootCount: payload.movedToRootCount,
  };
}

export async function moveLibraryItems(input: {
  itemIds: string[];
  folderId: string | null;
}): Promise<{ movedCount: number; folderId: string | null }> {
  const payload = await libraryRequest("POST", "/api/library/bulk-move", input);
  if (typeof payload.movedCount !== "number" || payload.movedCount !== input.itemIds.length) {
    throw new LibraryFolderRequestError("invalid_library_response", 503);
  }
  return { movedCount: payload.movedCount, folderId: input.folderId };
}
