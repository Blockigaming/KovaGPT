import {
  parseDocumentBlocks,
  safeDocumentFilename,
  downloadBytes,
  validateDocumentInput,
} from "./common";
import { createOfficePackage, xml } from "./office-package";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main",
  A = "http://schemas.openxmlformats.org/drawingml/2006/main",
  R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const namespaces = `xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`;
const group = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
const colors = `<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>`;
const relationships = (rows: Array<[string, string, string]>) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const textbox = (
  id: number,
  name: string,
  lines: string[],
  y: number,
  height: number,
  size: number,
  bold = false,
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="640080" y="${y}"/><a:ext cx="10911840" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${lines.map((text) => `<a:p><a:pPr><a:lnSpc><a:spcPts val="${Math.round(size * 1.3)}"/></a:lnSpc></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${bold ? "111827" : "1F2937"}"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t xml:space="preserve">${xml(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`).join("")}</p:txBody></p:sp>`;
export async function createDocumentPptx(title: string, markdown: string) {
  validateDocumentInput(title, markdown);
  const blocks = parseDocumentBlocks(markdown),
    allLines: string[] = [];
  const longTitle = Array.from(title).length > 50;
  if (longTitle) blocks.unshift({ kind: "paragraph", text: title });
  for (const block of blocks) {
    const text =
      block.kind === "list"
        ? `${block.ordered ? `${block.number}.` : "•"} ${block.text}`
        : block.text;
    for (const raw of text.split("\n")) {
      const points = Array.from(raw);
      for (let offset = 0; offset < Math.max(1, points.length); offset += 40)
        allLines.push(points.slice(offset, offset + 40).join(""));
    }
  }
  const slideCount = Math.max(1, Math.ceil(allLines.length / 11));
  if (slideCount > 200)
    throw new Error("PPTX export is limited to 200 slides. Split the document.");
  const titleText = longTitle ? "Document" : title || "Document";
  const titleLines =
    Array.from(titleText).length > 30
      ? [Array.from(titleText).slice(0, 30).join(""), Array.from(titleText).slice(30).join("")]
      : [titleText];
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
    "_rels/.rels": relationships([["rId1", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relationships([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ...Array.from({ length: slideCount }, (_, i): [string, string, string] => [
        `rId${i + 2}`,
        "slide",
        `slides/slide${i + 1}.xml`,
      ]),
    ]),
    "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0"?><p:sldMaster ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colors}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "theme", "../theme/theme1.xml"],
    ]),
    "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0"?><p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Text outline"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([
      ["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"],
    ]),
    "ppt/theme/theme1.xml": `<?xml version="1.0"?><a:theme xmlns:a="${A}" name="KovaGPT text"><a:themeElements><a:clrScheme name="Neutral">${Object.entries(
      {
        dk1: "111827",
        lt1: "FFFFFF",
        dk2: "1F2937",
        lt2: "EEF2F6",
        accent1: "334155",
        accent2: "475569",
        accent3: "64748B",
        accent4: "94A3B8",
        accent5: "CBD5E1",
        accent6: "E2E8F0",
        hlink: "2563EB",
        folHlink: "7C3AED",
      },
    )
      .map(([key, color]) => `<a:${key}><a:srgbClr val="${color}"/></a:${key}>`)
      .join(
        "",
      )}</a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Plain"><a:fillStyleLst>${Array.from({ length: 3 }, () => '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("")}</a:fillStyleLst><a:lnStyleLst>${Array.from({ length: 3 }, () => '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>').join("")}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${Array.from({ length: 3 }, () => '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("")}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  };
  for (let index = 0; index < slideCount; index++) {
    files[`ppt/slides/slide${index + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><p:sld ${namespaces}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${textbox(2, "Title", titleLines, 411480, 1143000, 3000, true)}${textbox(3, "Document text", allLines.slice(index * 11, (index + 1) * 11), 1783080, 4251960, 2000)}${textbox(4, "Slide number", [String(index + 1)], 6419088, 182880, 1000)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = relationships([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
    ]);
  }
  return createOfficePackage(files);
}
export async function exportDocumentPptx(title: string, markdown: string) {
  const bytes = await createDocumentPptx(title, markdown);
  downloadBytes(
    bytes,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    safeDocumentFilename(title, "pptx"),
  );
  return bytes;
}
