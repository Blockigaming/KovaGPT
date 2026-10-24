export const DOCUMENT_EXPORT_PATH = "/api/document-export";
export const MAX_DOCUMENT_EXPORT_BYTES = 8 * 1024 * 1024;
// Base64url needs no percent escaping. Leave room for the bounded filename/fields.
export const MAX_DOCUMENT_EXPORT_FORM_BYTES = Math.ceil(MAX_DOCUMENT_EXPORT_BYTES / 3) * 4 + 4096;
export const DOCUMENT_EXPORT_TYPES = Object.freeze({
  md: "text/plain;charset=utf-8",
  html: "text/plain;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});

export function safeExportDeliveryFilename(filename, format) {
  if (
    !Object.hasOwn(DOCUMENT_EXPORT_TYPES, format) ||
    typeof filename !== "string" ||
    filename.length > 200 ||
    !filename.endsWith(`.${format}`)
  )
    throw new Error("invalid_filename");
  const base = filename
    .slice(0, -(format.length + 1))
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\\/:*?"<>|]/gu, "")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 120);
  const usable =
    base && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(base) ? base : "document";
  return `${usable}.${format}`;
}

export function encodeDocumentExportBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_EXPORT_BYTES)
    throw new Error(
      "Server delivery supports files up to 8 MiB. Use a local download for larger files.",
    );
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
