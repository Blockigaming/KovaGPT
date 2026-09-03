export const MAX_LIBRARY_FOLDERS = 200;
export const MAX_LIBRARY_FOLDER_DEPTH = 12;
export const MAX_LIBRARY_FOLDER_NAME_LENGTH = 120;
export const MAX_LIBRARY_BULK_ITEMS = 100;
export const MAX_LIBRARY_MUTATION_BODY_BYTES = 16 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INVALID_FOLDER_NAME_PATTERN = /[\u0000-\u001f\u007f/\\]/u;

export class LibraryFolderInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "LibraryFolderInputError";
    this.code = code;
  }
}

function objectWithExactKeys(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryFolderInputError("invalid_request");
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new LibraryFolderInputError("unknown_field");
  }
  return value;
}

function requiredUuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new LibraryFolderInputError(code);
  }
  return value.toLowerCase();
}

function nullableUuid(value, code) {
  if (value === null) return null;
  return requiredUuid(value, code);
}

export function normalizeLibraryFolderName(value) {
  if (typeof value !== "string") throw new LibraryFolderInputError("invalid_folder_name");
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    !name ||
    name.length > MAX_LIBRARY_FOLDER_NAME_LENGTH ||
    name === "." ||
    name === ".." ||
    INVALID_FOLDER_NAME_PATTERN.test(name)
  ) {
    throw new LibraryFolderInputError("invalid_folder_name");
  }
  return name;
}

export function parseCreateLibraryFolder(value) {
  const input = objectWithExactKeys(value, new Set(["name", "parentId"]));
  if (!("name" in input)) throw new LibraryFolderInputError("invalid_folder_name");
  return Object.freeze({
    name: normalizeLibraryFolderName(input.name),
    parentId: "parentId" in input ? nullableUuid(input.parentId, "invalid_parent_id") : null,
  });
}

export function parseUpdateLibraryFolder(value) {
  const input = objectWithExactKeys(value, new Set(["id", "name", "parentId"]));
  const hasName = "name" in input;
  const hasParent = "parentId" in input;
  if (!hasName && !hasParent) throw new LibraryFolderInputError("empty_folder_update");
  return Object.freeze({
    id: requiredUuid(input.id, "invalid_folder_id"),
    name: hasName ? normalizeLibraryFolderName(input.name) : null,
    parentId: hasParent ? nullableUuid(input.parentId, "invalid_parent_id") : null,
    parentSupplied: hasParent,
  });
}

export function parseDeleteLibraryFolder(value) {
  const input = objectWithExactKeys(value, new Set(["id"]));
  return Object.freeze({ id: requiredUuid(input.id, "invalid_folder_id") });
}

export function parseBulkMoveLibraryItems(value) {
  const input = objectWithExactKeys(value, new Set(["itemIds", "folderId"]));
  if (!Array.isArray(input.itemIds)) {
    throw new LibraryFolderInputError("invalid_library_items");
  }
  if (input.itemIds.length < 1 || input.itemIds.length > MAX_LIBRARY_BULK_ITEMS) {
    throw new LibraryFolderInputError("invalid_library_item_count");
  }
  const itemIds = input.itemIds.map((id) => requiredUuid(id, "invalid_library_item_id"));
  if (new Set(itemIds).size !== itemIds.length) {
    throw new LibraryFolderInputError("duplicate_library_item_id");
  }
  if (!("folderId" in input)) throw new LibraryFolderInputError("invalid_folder_id");
  return Object.freeze({
    itemIds: Object.freeze(itemIds),
    folderId: nullableUuid(input.folderId, "invalid_folder_id"),
  });
}

export function libraryMutationErrorStatus(code) {
  if (code === "23505") return 409;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "23514" || code === "P0001") return 400;
  return 503;
}
