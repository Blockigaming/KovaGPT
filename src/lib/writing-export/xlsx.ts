import {
  parseDocumentBlocks,
  safeDocumentFilename,
  downloadBytes,
  validateDocumentInput,
} from "./common";
import { createOfficePackage, xml } from "./office-package";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function columnName(column: number) {
  let name = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}
export async function createDocumentXlsx(title: string, markdown: string) {
  validateDocumentInput(title, markdown);
  const blocks = parseDocumentBlocks(markdown);
  // Narrative text is retained, and every Markdown table gets its own sheet.
  const sheets: Array<{ name: string; rows: string[][] }> = [
    {
      name: "Document",
      rows: [
        [title || "Document"],
        ...blocks.filter((block) => block.kind !== "table").map((block) => [block.text]),
      ],
    },
  ];
  for (const block of blocks)
    if (block.kind === "table" && block.rows)
      sheets.push({ name: `Table ${sheets.length}`, rows: block.rows });
  if (
    sheets.length > 50 ||
    sheets.some(
      (sheet) =>
        sheet.rows.length > 5000 ||
        sheet.rows.some((row) => row.some((value) => value.length > 32767)),
    )
  )
    throw new Error(
      "XLSX export supports 50 sheets, 5,000 rows per sheet, and 32,767 characters per cell. Split longer content.",
    );
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((sheet, index) => {
    const columns = Math.max(...sheet.rows.map((row) => row.length));
    const columnWidth = columns === 1 ? 75 : 28;
    const rowHeights = sheet.rows.map((row) => {
      const lines = Math.max(
        ...row.map((value) =>
          value.split("\n").reduce((sum, line) => {
            const width = Array.from(line).reduce(
              (total, point) => total + (point.codePointAt(0)! > 0x2e80 ? 2 : 1),
              0,
            );
            return sum + Math.max(1, Math.ceil(width / (columnWidth * 0.85)));
          }, 0),
        ),
      );
      const height = lines * 15 + 6;
      if (height > 409)
        throw new Error(
          "A spreadsheet cell is too long to display fully. Split the paragraph or table cell, or use DOCX.",
        );
      return height;
    });
    files[`xl/worksheets/sheet${index + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columns}" width="${columnWidth}" customWidth="1"/></cols><sheetData>${sheet.rows.map((row, i) => `<row r="${i + 1}" ht="${rowHeights[i]}" customHeight="1">${row.map((value, c) => `<c r="${columnName(c)}${i + 1}" t="inlineStr" s="${i === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="1" orientation="${columns > 3 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  });
  // User text is always inlineStr; leading '=' cannot become a workbook formula.
  return createOfficePackage(files);
}
export async function exportDocumentXlsx(title: string, markdown: string) {
  const bytes = await createDocumentXlsx(title, markdown);
  downloadBytes(
    bytes,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    safeDocumentFilename(title, "xlsx"),
  );
  return bytes;
}
