import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("assistant Markdown renders model-supplied images as inert links", async () => {
  const source = await read("src/components/ChatMessage.tsx");

  assert.match(source, /img:\s*\(\{ alt, src \}[^]*?<a href=\{src\}/u);
  assert.match(source, /rel="noreferrer noopener"/u);
});
