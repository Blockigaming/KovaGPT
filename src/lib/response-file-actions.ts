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
export function downloadResponseFile(file: Pick<ResponseFile, "name" | "content" | "mime">) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
