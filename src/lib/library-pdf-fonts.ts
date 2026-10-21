// Vite inlines only these installed, licensed assets into the lazy PDF module.
// No resource URL from a PDF is fetched. Notices: docs/pdf-preview-font-licenses.txt.
import dingbats from "pdfjs-dist/standard_fonts/FoxitDingbats.pfb?inline&url";
import fixed from "pdfjs-dist/standard_fonts/FoxitFixed.pfb?inline&url";
import fixedBold from "pdfjs-dist/standard_fonts/FoxitFixedBold.pfb?inline&url";
import fixedBoldItalic from "pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb?inline&url";
import fixedItalic from "pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb?inline&url";
import serif from "pdfjs-dist/standard_fonts/FoxitSerif.pfb?inline&url";
import serifBold from "pdfjs-dist/standard_fonts/FoxitSerifBold.pfb?inline&url";
import serifBoldItalic from "pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb?inline&url";
import serifItalic from "pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb?inline&url";
import symbol from "pdfjs-dist/standard_fonts/FoxitSymbol.pfb?inline&url";
import sans from "pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?inline&url";
import sansBold from "pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?inline&url";
import sansBoldItalic from "pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?inline&url";
import sansItalic from "pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?inline&url";

export const bundledPreviewFonts: Readonly<Record<string, string>> = Object.freeze({
  "FoxitDingbats.pfb": dingbats,
  "FoxitFixed.pfb": fixed,
  "FoxitFixedBold.pfb": fixedBold,
  "FoxitFixedBoldItalic.pfb": fixedBoldItalic,
  "FoxitFixedItalic.pfb": fixedItalic,
  "FoxitSerif.pfb": serif,
  "FoxitSerifBold.pfb": serifBold,
  "FoxitSerifBoldItalic.pfb": serifBoldItalic,
  "FoxitSerifItalic.pfb": serifItalic,
  "FoxitSymbol.pfb": symbol,
  "LiberationSans-Regular.ttf": sans,
  "LiberationSans-Bold.ttf": sansBold,
  "LiberationSans-BoldItalic.ttf": sansBoldItalic,
  "LiberationSans-Italic.ttf": sansItalic,
});
