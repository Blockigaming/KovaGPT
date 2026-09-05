import { strToU8, zipSync } from "fflate";
export const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function createOfficePackage(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  let size = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = strToU8(text);
    size += bytes.length;
    if (size > 16_000_000 || Object.keys(entries).length >= 2000)
      throw new Error("This Office export is too large. Split the document.");
    entries[name] = bytes;
  }
  return zipSync(entries, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}
