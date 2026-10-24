import { safeDocumentFilename } from "./common";
import {
  encodeDocumentExportBytes,
  safeExportDeliveryFilename,
  type DocumentDeliveryFormat,
} from "../document-export-policy.mjs";

/** Prepare locally. Only a separate, explicit native form submission sends bytes. */
export async function prepareServerDocument(
  format: DocumentDeliveryFormat,
  title: string,
  content: string,
) {
  const bytes =
    format === "md" || format === "html" || format === "txt"
      ? new TextEncoder().encode(content)
      : (await (await import("./export")).createDocumentFile(format, title, content)).bytes;
  return {
    format,
    filename: safeExportDeliveryFilename(safeDocumentFilename(title, format), format),
    bytes: encodeDocumentExportBytes(bytes),
  };
}
