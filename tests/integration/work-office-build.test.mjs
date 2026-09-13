import assert from "node:assert/strict";
import test from "node:test";
import { extractOfficeDocument } from "../../src/lib/document-extraction/office.mjs";
import { readFile } from "node:fs/promises";

test("standalone Work writer build resolves real local fonts and creates portable output bytes", async () => {
  const { configuredOfficeWriters } = await import("../../work-runner/build/office.mjs");
  const { startConfiguredWorkRunner } = await import("../../work-runner/entrypoint.mjs");
  assert.equal(typeof startConfiguredWorkRunner, "function");
  const writers = await configuredOfficeWriters();
  for (const format of ["docx", "xlsx", "pptx"]) {
    const bytes = await writers[format](
      "Run output",
      "# Results\n\nCafé Ελληνικά\n\n| A | B |\n| --- | --- |\n| Complete | =1+1 |",
    );
    assert.ok(bytes instanceof Uint8Array);
    const content = extractOfficeDocument(bytes, format).text;
    assert.match(content, /Café Ελληνικά/);
    assert.match(content, /Complete/);
    assert.match(content, /=1\+1/);
  }
  const pdf = await writers.pdf("Run output", "Café Ελληνικά");
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 1000);
  const built = await readFile(
    new URL("../../work-runner/build/office.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(built, /\.ttf\?url/);
});
