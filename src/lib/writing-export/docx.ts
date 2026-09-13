import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  parseDocumentBlocks,
  safeDocumentFilename,
  downloadBytes,
  validateDocumentInput,
} from "./common";
export async function createDocumentDocx(title: string, markdown: string) {
  validateDocumentInput(title, markdown);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "CCD1D8" };
  const paragraph = (text: string, code = false) =>
    new Paragraph({
      children: text.split("\n").map(
        (line, index) =>
          new TextRun({
            text: line,
            ...(index ? { break: 1 } : {}),
            ...(code ? { font: "Courier New", size: 19 } : {}),
          }),
      ),
    });
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: title || "Document", heading: HeadingLevel.TITLE }),
  ];
  const orderedStarts: number[] = [];
  let previousOrdered = false;
  for (const block of parseDocumentBlocks(markdown)) {
    const ordered = block.kind === "list" && block.ordered === true;
    if (ordered && !previousOrdered) orderedStarts.push(block.number ?? 1);
    previousOrdered = ordered;
    if (block.kind === "table" && block.rows) {
      const widths = Array.from(
        { length: block.rows[0].length },
        (_, index) =>
          Math.floor(9360 / block.rows![0].length) + (index < 9360 % block.rows![0].length ? 1 : 0),
      );
      children.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          indent: { size: 120, type: WidthType.DXA },
          columnWidths: widths,
          layout: TableLayoutType.FIXED,
          rows: block.rows.map(
            (row, index) =>
              new TableRow({
                tableHeader: index === 0,
                children: row.map(
                  (cell, col) =>
                    new TableCell({
                      width: { size: widths[col], type: WidthType.DXA },
                      margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      borders: { top: border, bottom: border, left: border, right: border },
                      ...(index === 0 ? { shading: { fill: "EEF2F6" } } : {}),
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: cell, bold: index === 0 })],
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
    } else if (block.kind === "heading") {
      const headings = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
      ] as const;
      children.push(
        new Paragraph({ text: block.text, heading: headings[Math.min(3, block.level ?? 1) - 1] }),
      );
    } else if (block.kind === "list")
      children.push(
        new Paragraph({
          text: block.text,
          numbering: {
            reference: block.ordered ? `ordered-${orderedStarts.length}` : "bullets",
            level: 0,
          },
        }),
      );
    else if (block.kind === "quote")
      children.push(
        new Paragraph({
          text: block.text,
          indent: { left: 360 },
          border: { left: { ...border, size: 12 } },
        }),
      );
    else children.push(paragraph(block.text, block.kind === "code"));
  }
  const document = new Document({
    creator: "KovaGPT",
    title: title || "Document",
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 22, color: "1F2937" },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Arial", size: 48, bold: true, color: "111827" },
          paragraph: { spacing: { before: 0, after: 240 }, keepNext: true },
        },
        ...[1, 2, 3].map((level) => ({
          id: `Heading${level}`,
          name: `Heading ${level}`,
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Arial", size: 36 - level * 4, bold: true, color: "111827" },
          paragraph: { spacing: { before: 220, after: 120 }, keepNext: true },
        })),
      ],
    },
    numbering: {
      config: [
        ...orderedStarts.map((start, index) => ({
          reference: `ordered-${index + 1}`,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              start,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 240 } } },
            },
          ],
        })),
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
export async function exportDocumentDocx(title: string, markdown: string) {
  const bytes = await createDocumentDocx(title, markdown);
  downloadBytes(
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    safeDocumentFilename(title, "docx"),
  );
  return bytes;
}
