import { readFile } from "node:fs/promises";
import { createDocumentDocx } from "../src/lib/writing-export/docx";
import { createDocumentPdf } from "../src/lib/writing-export/pdf";
import { createDocumentXlsx } from "../src/lib/writing-export/xlsx";
import { createDocumentPptx } from "../src/lib/writing-export/pptx";
export async function configuredOfficeWriters(
  fontDirectory = new URL("../../src/assets/document-fonts/", import.meta.url),
) {
  const regular = new Uint8Array(await readFile(new URL("DejaVuSans.ttf", fontDirectory)));
  const bold = new Uint8Array(await readFile(new URL("DejaVuSans-Bold.ttf", fontDirectory)));
  return {
    docx: createDocumentDocx,
    xlsx: createDocumentXlsx,
    pptx: createDocumentPptx,
    pdf: (title: string, markdown: string) => createDocumentPdf(title, markdown, { regular, bold }),
  };
}
