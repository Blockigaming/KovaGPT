export const LIBRARY_ORIGINAL_BUCKET: "library-files";
export const LIBRARY_ORIGINAL_MAX_BYTES: number;
export const ORIGINAL_DOCUMENT_MIMES: Readonly<Record<string, string>>;
export class LibraryOriginalError extends Error {
  status: number;
  constructor(message?: string, status?: number);
}
export type OriginalDocument = {
  id: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
  text: string;
  extension: string;
};
export type OriginalRecord = {
  id: string;
  owner_id: string;
  generation: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  state: string;
};
export function validateOriginalDocument(value: {
  id: unknown;
  name: unknown;
  contentType: unknown;
  bytes: unknown;
  text: unknown;
}): OriginalDocument;
export function validOriginalPath(owner: unknown, generation: unknown, path: unknown): boolean;
export function validateOriginalRecord(
  value: unknown,
  owner: string,
  id: string,
  generation?: string,
): OriginalRecord;
export function originalDocumentSha256(bytes: Uint8Array): Promise<string>;
