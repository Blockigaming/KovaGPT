import { validateWorkCsv } from "./csv-safety.mjs";
/** Pure local writers; generated text and spreadsheet cells never execute formulas. */
export function createWorkRenderer(office = {}) {
  const mimes = {
    markdown: "text/markdown",
    text: "text/plain",
    json: "application/json",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return async (item) => {
    const mimeType = mimes[item.format];
    if (!mimeType) throw new Error("work_output_format_unsupported");
    if (["docx", "pdf", "xlsx", "pptx"].includes(item.format)) {
      if (typeof office[item.format] !== "function")
        throw new Error("work_document_writer_unavailable");
      return { mimeType, bytes: await office[item.format](item.title, item.content) };
    }
    let content = item.content;
    if (item.format === "json") content = JSON.stringify(JSON.parse(content), null, 2);
    if (item.format === "csv") validateWorkCsv(content);
    return { mimeType, bytes: new TextEncoder().encode(content) };
  };
}
