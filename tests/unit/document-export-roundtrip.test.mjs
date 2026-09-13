import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractOfficeDocument, readOfficeXml } from "../../src/lib/document-extraction/office.mjs";
import { zipSync, strToU8 } from "fflate";
import { load, fonts } from "../helpers/document-writers.mjs";
const { createDocumentPdf } = load("src/lib/writing-export/pdf.ts");
const { createDocumentDocx } = load("src/lib/writing-export/docx.ts");
const { createDocumentXlsx } = load("src/lib/writing-export/xlsx.ts");
const { createDocumentPptx } = load("src/lib/writing-export/pptx.ts");
const { parseDocumentBlocks } = load("src/lib/writing-export/common.ts");
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

test("PDF paginates long Unicode text without clipping it below the page or replacing characters", async () => {
  const source = Array.from(
    { length: 180 },
    (_, i) =>
      `Paragraph ${i}: Café naïve résumé — Ελληνικά Кириллица. The complete sentence stays readable.`,
  ).join("\n\n");
  const bytes = await createDocumentPdf("Unicode report", source, fonts);
  const task = getDocument({ data: bytes, disableFontFace: true });
  const document = await task.promise;
  try {
    assert.ok(document.numPages > 3);
    let text = "";
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber),
        content = await page.getTextContent();
      for (const item of content.items)
        if ("str" in item) {
          text += item.str + " ";
          assert.ok(
            item.transform[5] >= 20 && item.transform[5] <= 760,
            `page ${pageNumber} text outside content bounds`,
          );
        }
    }
    assert.match(text, /Café naïve résumé/);
    assert.match(text, /Ελληνικά Кириллица/);
    assert.match(text, /Paragraph 179/);
    assert.doesNotMatch(text, /\?{2,}/);
  } finally {
    await task.destroy();
  }
});
test("PDF fails explicitly for unsupported glyphs and oversized input instead of corrupting or truncating it", async () => {
  await assert.rejects(createDocumentPdf("Test", "漢字", fonts), /cannot represent/);
  await assert.rejects(createDocumentPdf("Test", "x".repeat(200001), fonts), /200,000/);
  await assert.rejects(createDocumentPdf("Test", "bad\u0000text", fonts), /invalid text/);
});
test("DOCX emits complete Unicode tables, explicit geometry, real lists and defined styles", async () => {
  const bytes = await createDocumentDocx(
    "Résumé",
    "# Results\n\n| Name | Value |\n| --- | --- |\n| Café | α & β |\n| Pipe | a \\| b |\n\n1. First\n2. Second\n\n- Item\n\n```\nline one\nline two\n```",
  );
  const files = unzipSync(bytes),
    xml = strFromU8(files["word/document.xml"]);
  const parsed = parser.parse(xml),
    table = parsed["w:document"]["w:body"]["w:tbl"];
  assert.equal(table["w:tr"].length, 3);
  assert.equal(
    table["w:tblGrid"]["w:gridCol"].reduce((sum, col) => sum + Number(col["@_w:w"]), 0),
    9360,
  );
  assert.match(xml, /α &amp; β/);
  assert.match(xml, /a \| b/);
  assert.match(xml, /<w:numPr>/);
  assert.match(xml, /<w:br\/>/);
  assert.ok(files["word/styles.xml"] && files["word/numbering.xml"]);
  assert.doesNotMatch(xml, />---</);
});
test("XLSX retains narrative and every table while leading formula characters remain literal text", async () => {
  const bytes = await createDocumentXlsx(
    "Data",
    'Narrative retained\n\n| Name | Formula-like text |\n| --- | --- |\n| Café | =HYPERLINK("https://invalid.test") |\n| Value | +1+1 |',
  );
  const files = unzipSync(bytes),
    sheet = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.ok(files["xl/workbook.xml"] && files["xl/styles.xml"]);
  assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]), /Narrative retained/);
  assert.match(sheet, /t="inlineStr"/);
  assert.match(sheet, /=HYPERLINK/);
  assert.doesNotMatch(sheet, /<f[ >]/);
  const parsed = parser.parse(sheet);
  assert.equal(parsed.worksheet.sheetData.row.length, 3);
});
test("PPTX is a valid editable outline and preserves long content across slides", async () => {
  const text = Array.from({ length: 100 }, (_, i) => `Unique line ${i} with Unicode Café α`).join(
    "\n",
  );
  const bytes = await createDocumentPptx("Outline", `# First heading\n\n${text}\n\n# Last heading`);
  const files = unzipSync(bytes),
    slides = Object.entries(files).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
  assert.ok(slides.length > 3);
  assert.ok(files["ppt/presentation.xml"]);
  const full = slides.map(([, data]) => strFromU8(data)).join("\n");
  assert.match(full, /Unique line 99/);
  assert.match(full, /First heading/);
  assert.match(full, /Last heading/);
  assert.match(full, /Café α/);
  for (const [, data] of slides) assert.ok(parser.parse(strFromU8(data))["p:sld"]);
});
test("block parser joins table rows and rejects inconsistent widths without dropping source", () => {
  const blocks = parseDocumentBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter");
  assert.equal(blocks[0].rows.length, 2);
  assert.equal(blocks[1].text, "After");
  assert.throws(() => parseDocumentBlocks("| A | B |\n| --- | --- |\n| 1 |"), /consistent columns/);
});

test("Office extraction round trips complete document, slide and cell text without evaluating formulas", async () => {
  const markdown = "# Header\n\nCafé Ελληνικά\n\n| Item | Value |\n| --- | --- |\n| Total | =1+1 |";
  for (const [extension, create] of [
    ["docx", createDocumentDocx],
    ["xlsx", createDocumentXlsx],
    ["pptx", createDocumentPptx],
  ]) {
    const result = extractOfficeDocument(await create("Title", markdown), extension);
    assert.match(result.text, /Café Ελληνικά/);
    assert.match(result.text, /=1\+1/);
    assert.ok(result.note.length > 20);
  }
});
test("Office extraction rejects ZIP bombs, traversal, active content, unsafe XML, mismatches and full-text overflow", async () => {
  const original = unzipSync(await createDocumentDocx("Title", "Content"));
  const withPart = (name, data) => zipSync({ ...original, [name]: strToU8(data) });
  assert.throws(() => readOfficeXml(withPart("../evil.xml", "<a/>")), /unsafe/);
  assert.throws(() => readOfficeXml(withPart("word/vbaProject.bin", "macro")), /macros/);
  assert.throws(
    () => readOfficeXml(withPart("word/bomb.xml", "x".repeat(2 * 1024 * 1024 + 1))),
    /limit/,
  );
  assert.throws(
    () =>
      extractOfficeDocument(
        withPart(
          "word/extra.xml",
          '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><x>&secret;</x>',
        ),
        "docx",
      ),
    /entities/,
  );
  assert.throws(
    () =>
      extractOfficeDocument(
        withPart("word/extra.xml", "<a>".repeat(81) + "</a>".repeat(81)),
        "docx",
      ),
    /deeply/,
  );
  assert.throws(() => extractOfficeDocument(zipSync(original), "xlsx"), /missing/);
  const large = await createDocumentDocx("Title", "x".repeat(80001));
  assert.throws(() => extractOfficeDocument(large, "docx"), /80,000/);
});

test("DOCX extraction excludes hidden runs, deleted text and field instructions", async () => {
  const files = unzipSync(await createDocumentDocx("Title", "Visible"));
  files["word/document.xml"] = strToU8(
    strFromU8(files["word/document.xml"]).replace(
      "</w:body>",
      "<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>HiddenSecret</w:t></w:r><w:del><w:r><w:t>DeletedSecret</w:t></w:r></w:del><w:r><w:instrText>FieldSecret</w:instrText></w:r></w:p></w:body>",
    ),
  );
  const result = extractOfficeDocument(zipSync(files), "docx");
  assert.match(result.text, /Visible/);
  assert.doesNotMatch(result.text, /Secret/);
});

test("Office XML depth limits respect quoted delimiters, comments and CDATA", async () => {
  const original = unzipSync(await createDocumentDocx("Title", "Visible"));
  const extractExtra = (xml) =>
    extractOfficeDocument(zipSync({ ...original, "word/extra.xml": strToU8(xml) }), "docx");
  for (const tag of ['<x a="/>">', "<x a='/>'>", '<x a="\'>" b="/>">']) {
    assert.throws(() => extractExtra(tag.repeat(81) + "</x>".repeat(81)), /deeply/);
  }
  assert.match(
    extractExtra(
      '<x a="/>"><!-- ' +
        "<ignored>".repeat(100) +
        " --><![CDATA[" +
        "<ignored>".repeat(100) +
        ']]><child a="/>"/></x>',
    ).text,
    /Visible/,
  );
  assert.throws(() => extractExtra('<x a="unterminated>'), /invalid XML/);
});

test("Word ordered lists preserve each list's starting number and reject unrepresentable list/table syntax", async () => {
  const files = unzipSync(
    await createDocumentDocx("Lists", "7. First\n8. Second\n\nA break\n\n3. Another"),
  );
  const numbering = strFromU8(files["word/numbering.xml"]);
  assert.match(numbering, /w:start w:val="7"/);
  assert.match(numbering, /w:start w:val="3"/);
  assert.throws(() => parseDocumentBlocks("999999999999999999999999. Text"), /list number/);
  assert.throws(() => parseDocumentBlocks("| a | b |\n| --- |\n| c | d |"), /separator/);
});
