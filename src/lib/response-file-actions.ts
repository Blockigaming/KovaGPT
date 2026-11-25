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
    const { PDFDocument } = await import("pdf-lib");
    if (!file.content.trim()) {
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]);
      blob = new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
    } else {
      const { createDocumentPdf } = await import("./writing-export/pdf");
      const bytes = await createDocumentPdf(file.name.replace(/\.pdf$/iu, ""), file.content);
      blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    }
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
