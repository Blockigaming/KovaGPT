import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const DOCUMENT_INPUT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_TEXT_CHARS = 80_000;
const PART_BYTES = 2 * 1024 * 1024;
const EXPANDED_BYTES = 12 * 1024 * 1024;
export class DocumentExtractionError extends Error {}
const fail = (message) => {
  throw new DocumentExtractionError(message);
};

// Untrusted archives are streamed in small compressed chunks. Never allocate an
// entry using its advertised size, or unzip the complete archive before limits.
export function readOfficeXml(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > DOCUMENT_INPUT_BYTES || bytes.length < 4)
    fail("Documents must be at most 10 MB.");
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4)
    fail(
      "This is not a supported Office document. Legacy .doc, .xls and .ppt files are unsupported.",
    );
  const files = new Map(),
    names = new Set();
  let total = 0,
    pending = 0;
  const unzip = new Unzip((file) => {
    if (
      names.size >= 2000 ||
      names.has(file.name) ||
      !/^[a-zA-Z0-9_[\]. /-]+$/u.test(file.name) ||
      file.name.startsWith("/") ||
      file.name.split("/").some((part) => part === ".." || part === ".")
    )
      fail("The document archive has unsafe or excessive entries.");
    names.add(file.name);
    if (/vbaProject|activeX|embeddings\//iu.test(file.name))
      fail("Documents with macros or embedded executable objects are unsupported.");
    if (!/\.xml$|\.rels$/iu.test(file.name)) return;
    if (file.originalSize !== undefined && file.originalSize > PART_BYTES)
      fail("A document part exceeds the 2 MB extraction limit.");
    let size = 0;
    const chunks = [];
    pending++;
    file.ondata = (error, chunk, final) => {
      if (error) fail("The document archive could not be read.");
      size += chunk.length;
      total += chunk.length;
      if (size > PART_BYTES || total > EXPANDED_BYTES) {
        file.terminate();
        fail("The document expands beyond the safe extraction limit.");
      }
      chunks.push(chunk);
      if (final) {
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const item of chunks) {
          joined.set(item, offset);
          offset += item.length;
        }
        files.set(file.name, strFromU8(joined));
        pending--;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096)
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  if (pending || !files.has("[Content_Types].xml")) fail("The document archive is incomplete.");
  return files;
}

function parseXml(xml) {
  if (typeof xml !== "string" || /<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml))
    fail("Document XML entities and external document types are unsupported.");
  // Bound parser work before constructing a nested tree, including maliciously
  // deep but otherwise valid XML. Processing instructions are never executed.
  let depth = 0,
    tags = 0;
  for (let offset = 0; offset < xml.length;) {
    const start = xml.indexOf("<", offset);
    if (start < 0) break;
    if (++tags > 100_000) fail("The document has too many XML elements.");
    const terminator = xml.startsWith("<!--", start)
      ? "-->"
      : xml.startsWith("<![CDATA[", start)
        ? "]]>"
        : xml.startsWith("<?", start)
          ? "?>"
          : null;
    if (terminator) {
      const end = xml.indexOf(terminator, start + 2);
      if (end < 0) fail("The document contains invalid XML.");
      offset = end + terminator.length;
      continue;
    }
    // Attribute values can contain '>' or '/>'. Only an unquoted delimiter
    // ends a tag; otherwise a deeply nested tree can masquerade as empty tags.
    let quote = null,
      end = start + 1;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === xml.length) fail("The document contains invalid XML.");
    if (xml[start + 1] === "/") depth--;
    else if (xml[start + 1] !== "!" && xml[end - 1] !== "/") depth++;
    if (depth > 80) fail("The document XML is too deeply nested.");
    if (depth < 0) fail("The document contains invalid XML.");
    offset = end + 1;
  }
  if (XMLValidator.validate(xml) !== true) fail("The document contains invalid XML.");
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: true,
    trimValues: false,
    htmlEntities: false,
  }).parse(xml);
}
function nodes(tree, name, result = []) {
  for (const node of tree) {
    if (Object.hasOwn(node, name)) result.push(node);
    for (const [key, value] of Object.entries(node))
      if (key !== ":@" && Array.isArray(value)) nodes(value, name, result);
  }
  return result;
}
function text(tree) {
  let value = "";
  for (const node of tree)
    for (const [key, child] of Object.entries(node)) {
      if (key === "#text") value += String(child);
      else if (key.endsWith(":tab")) value += "\t";
      else if (key.endsWith(":br")) value += "\n";
      else if (key !== ":@" && Array.isArray(child)) value += text(child);
    }
  return value;
}
function part(files, path) {
  if (!files.has(path)) fail("A required document part is missing.");
  return parseXml(files.get(path));
}
function relationships(files, path, base) {
  return new Map(
    nodes(part(files, path), "Relationship").map((node) => {
      const attr = node[":@"] ?? {},
        target = attr["@_Target"];
      if (attr["@_TargetMode"] === "External") return [attr["@_Id"], null];
      if (typeof target !== "string" || /[:\\%?#]/u.test(target))
        fail("The document has an unsafe part relationship.");
      const segments = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
      const resolved = [];
      for (const segment of segments) {
        if (segment === "..") {
          if (!resolved.length) fail("The document relationship escapes its archive.");
          resolved.pop();
        } else if (segment !== "." && segment) resolved.push(segment);
      }
      return [attr["@_Id"], resolved.join("/")];
    }),
  );
}
export function boundedDocumentText(sections) {
  const value = sections.join("\n\n");
  if (value.length > DOCUMENT_TEXT_CHARS || new TextEncoder().encode(value).length > 200_000)
    fail("Extracted text exceeds 80,000 characters or 200 KB. Split the document and try again.");
  if (!value.trim()) fail("This document contains no extractable text.");
  return value;
}
export function extractOfficeDocument(bytes, extension) {
  const files = readOfficeXml(bytes),
    output = [];
  // Validate every XML part, even ones the text-only importer does not use.
  for (const xml of files.values()) parseXml(xml);
  const append = (value) => {
    output.push(value);
    boundedDocumentText(output);
  };
  if (extension === "docx") {
    const document = part(files, "word/document.xml");
    for (const paragraph of nodes(document, "w:p")) {
      // Only visible runs. Field instructions, deleted text and metadata are
      // not treated as user-facing body text or executable instructions.
      const visible = (tree) =>
        tree
          .map((node) => {
            if (node["w:del"] || node["w:moveFrom"]) return "";
            if (node["w:r"] && nodes(node["w:r"], "w:vanish").length) return "";
            if (node["w:t"]) return text(node["w:t"]);
            if (node["w:tab"]) return "\t";
            if (node["w:br"]) return "\n";
            return Object.entries(node)
              .filter(([key, child]) => key !== ":@" && Array.isArray(child))
              .map(([, child]) => visible(child))
              .join("");
          })
          .join("");
      const value = visible(paragraph["w:p"]);
      if (value.trim()) append(value);
    }
    return {
      text: boundedDocumentText(output),
      note: "Extracted DOCX body text; headers, comments, images and layout are not included.",
    };
  }
  if (extension === "pptx") {
    const presentation = part(files, "ppt/presentation.xml");
    const refs = relationships(files, "ppt/_rels/presentation.xml.rels", "ppt/");
    const slides = nodes(presentation, "p:sldId");
    if (slides.length > 100) fail("Presentation extraction supports up to 100 slides.");
    for (const [index, slide] of slides.entries()) {
      const path = refs.get(slide[":@"]?.["@_r:id"]);
      if (!path?.startsWith("ppt/slides/"))
        fail("A presentation slide relationship is unsupported.");
      const paragraphs = nodes(part(files, path), "a:p").map((node) =>
        nodes(node["a:p"], "a:t")
          .map((run) => text(run["a:t"]))
          .join(""),
      );
      append(`[Slide ${index + 1}]\n${paragraphs.join("\n")}`);
    }
    return {
      text: boundedDocumentText(output),
      note: "Extracted slide text; images, speaker notes, animations and layout are not included.",
    };
  }
  if (extension === "xlsx") {
    const workbook = part(files, "xl/workbook.xml");
    const refs = relationships(files, "xl/_rels/workbook.xml.rels", "xl/");
    const shared = files.has("xl/sharedStrings.xml")
      ? nodes(part(files, "xl/sharedStrings.xml"), "si").map((node) => text(node.si))
      : [];
    const sheets = nodes(workbook, "sheet");
    if (sheets.length > 50 || shared.length > 50_000)
      fail("The workbook exceeds extraction limits.");
    let cellCount = 0;
    for (const sheet of sheets) {
      const attr = sheet[":@"] ?? {},
        path = refs.get(attr["@_r:id"]);
      if (!path?.startsWith("xl/worksheets/"))
        fail("A workbook sheet relationship is unsupported.");
      append(`[Sheet: ${attr["@_name"] ?? "Untitled"}]`);
      for (const row of nodes(part(files, path), "row")) {
        const values = [];
        for (const cell of nodes(row.row, "c")) {
          if (++cellCount > 25_000) fail("Workbook extraction supports up to 25,000 cells.");
          const type = cell[":@"]?.["@_t"];
          const raw = nodes(cell.c, "v")
            .map((node) => text(node.v))
            .join("");
          const formula = nodes(cell.c, "f").length > 0;
          let value =
            type === "inlineStr"
              ? nodes(cell.c, "t")
                  .map((node) => text(node.t))
                  .join("")
              : raw;
          if (type === "s") {
            if (!/^\d+$/u.test(raw) || Number(raw) >= shared.length)
              fail("A workbook shared string is invalid.");
            value = shared[Number(raw)];
          }
          const address = cell[":@"]?.["@_r"];
          if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/u.test(address ?? ""))
            fail("A workbook cell address is invalid.");
          values.push(
            `${address}: ${value}${formula ? (raw ? " [cached formula value]" : "[formula has no cached value]") : ""}`,
          );
        }
        if (values.length) append(values.join("\t"));
      }
    }
    return {
      text: boundedDocumentText(output),
      note: "Extracted sheet cell text and cached formula values; formulas are not recalculated. Charts, styling and external data are not included.",
    };
  }
  fail("Only DOCX, XLSX and PPTX Office files are supported.");
}
