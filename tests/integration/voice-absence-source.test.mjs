import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(entryPath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

test("user-facing source exposes no browser voice or dictation implementation", async () => {
  const files = await collectSourceFiles("src");
  const source = (
    await Promise.all(files.map(async (file) => `${file}\n${await readFile(file, "utf8")}`))
  ).join("\n");

  for (const forbidden of [
    /\bSpeechRecognition\b/u,
    /\bwebkitSpeechRecognition\b/u,
    /\bstartListening\b/u,
    /\bstopListening\b/u,
    /\bisListening\b/u,
    /\bvoiceMode\b/u,
    /Dictation is supported/iu,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }

  const composer = await readFile("src/components/ChatInput.tsx", "utf8");
  assert.doesNotMatch(composer, /\btoggleDictation\b|\bdictating\b|\brecognitionRef\b/u);
  assert.doesNotMatch(composer, /aria-label=.*(?:voice|dictat)/iu);
  assert.doesNotMatch(composer, /title=.*(?:Voice|Dictate)/u);
  assert.doesNotMatch(composer, /<Mic\b|<AudioLines\b/u);

  for (const entry of ["src/start.ts", "src/server.ts"]) {
    const securitySource = await readFile(entry, "utf8");
    assert.match(securitySource, /microphone=\(\)/u, `${entry} must deny microphone access`);
    assert.doesNotMatch(
      securitySource,
      /microphone=\(self\)/u,
      `${entry} must not grant browser microphone access`,
    );
  }
});
