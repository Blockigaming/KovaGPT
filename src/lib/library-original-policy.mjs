export const LIBRARY_ORIGINAL_BUCKET = "library-files";
export const LIBRARY_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024;
export const ORIGINAL_DOCUMENT_MIMES = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class LibraryOriginalError extends Error {
  constructor(message = "The original file could not be saved. Please retry.", status = 409) {
    super(message);
    this.status = status;
  }
}
export function validateOriginalDocument({ id, name, contentType, bytes, text }) {
  const extension = typeof name === "string" ? name.split(".").at(-1)?.toLowerCase() : undefined;
  if (
    !UUID.test(id ?? "") ||
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 200 ||
    /[\p{Cc}/\\]/u.test(name) ||
    !Object.hasOwn(ORIGINAL_DOCUMENT_MIMES, extension ?? "") ||
    ORIGINAL_DOCUMENT_MIMES[extension] !== contentType ||
    !(bytes instanceof Uint8Array) ||
    bytes.length < 8 ||
    bytes.length > LIBRARY_ORIGINAL_MAX_BYTES ||
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 200000
  )
    throw new LibraryOriginalError(
      "Choose a PDF, DOCX, XLSX, or PPTX file up to 10 MB with a name up to 200 characters.",
      400,
    );
  if (
    extension === "pdf"
      ? !/^%PDF-(?:1\.[0-7]|2\.0)/u.test(new TextDecoder().decode(bytes.subarray(0, 8)))
      : !(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4)
  )
    throw new LibraryOriginalError(
      "The original document format does not match its file name.",
      400,
    );
  return { id, name, contentType, bytes, text, extension };
}
export function validOriginalPath(owner, generation, path) {
  return (
    UUID.test(owner ?? "") &&
    UUID.test(generation ?? "") &&
    typeof path === "string" &&
    Object.keys(ORIGINAL_DOCUMENT_MIMES).some(
      (extension) => path === `${owner}/${generation}.${extension}`,
    )
  );
}
export function validateOriginalRecord(value, owner, id, generation) {
  if (
    !value ||
    typeof value !== "object" ||
    value.owner_id !== owner ||
    value.id !== id ||
    (generation && value.generation !== generation) ||
    !validOriginalPath(owner, value.generation, value.storage_path) ||
    !Object.values(ORIGINAL_DOCUMENT_MIMES).includes(value.mime_type) ||
    !Number.isSafeInteger(value.size_bytes) ||
    value.size_bytes < 1 ||
    value.size_bytes > LIBRARY_ORIGINAL_MAX_BYTES ||
    !/^[a-f0-9]{64}$/u.test(value.sha256 ?? "")
  )
    throw new LibraryOriginalError("This original file is no longer available.", 404);
  return value;
}
export async function originalDocumentSha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
