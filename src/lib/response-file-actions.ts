import { Code2, FileText, Globe, Image as ImageIcon } from "lucide-react";
import type { ResponseFile } from "@/lib/response-files.mjs";

/** Icon for a file card or preview header. */
export function fileIcon(file: Pick<ResponseFile, "language" | "category">) {
  if (file.language === "html") return Globe;
  if (file.language === "svg") return ImageIcon;
  if (file.category === "Document") return FileText;
  return Code2;
}

/** Save a reply's file locally with its own name and type. */
export async function downloadResponseFile(file: Pick<ResponseFile, "name" | "content" | "mime">) {
  let blob: Blob;
  if (/\.pdf$/iu.test(file.name)) {
    const { createBlankLetterPdf, createDocumentPdf } = await import("./writing-export/pdf");
    const bytes = file.content.trim()
      ? await createDocumentPdf(file.name.replace(/\.pdf$/iu, ""), file.content)
      : await createBlankLetterPdf();
    blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  } else {
    blob = new Blob([file.content], { type: file.mime });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
