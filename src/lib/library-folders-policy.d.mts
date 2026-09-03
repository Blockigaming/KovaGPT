export const MAX_LIBRARY_FOLDERS: number;
export const MAX_LIBRARY_FOLDER_DEPTH: number;
export const MAX_LIBRARY_FOLDER_NAME_LENGTH: number;
export const MAX_LIBRARY_BULK_ITEMS: number;
export const MAX_LIBRARY_MUTATION_BODY_BYTES: number;

export class LibraryFolderInputError extends Error {
  code: string;
  constructor(code: string);
}

export function normalizeLibraryFolderName(value: unknown): string;
export function parseCreateLibraryFolder(value: unknown): Readonly<{
  name: string;
  parentId: string | null;
}>;
export function parseUpdateLibraryFolder(value: unknown): Readonly<{
  id: string;
  name: string | null;
  parentId: string | null;
  parentSupplied: boolean;
}>;
export function parseDeleteLibraryFolder(value: unknown): Readonly<{ id: string }>;
export function parseBulkMoveLibraryItems(value: unknown): Readonly<{
  itemIds: readonly string[];
  folderId: string | null;
}>;
export function libraryMutationErrorStatus(code: string | undefined): number;
