import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
const base = "4ad3baeb1b7e00a43693e7b21d6e13bd8391b051";
for (const [path, old, corrected] of [
  [
    "src/routes/getting-started.tsx",
    "Signed-in users can view daily usage from Settings → Subscription.",
    "Signed-in users can view daily usage from Settings → Usage.",
  ],
  [
    "src/routes/blog.ai-market-research-guide.tsx",
    "retrieved material. Search are",
    "retrieved material. Search is",
  ],
  [
    "src/lib/writing-tool-catalog.ts",
    "Count words, characters, sentences, and lines locally as you type.",
    "Count words, characters, sentences, and lines in your browser.",
  ],
])
  test(`${path}: only the authorized copy replacement; behavior and unrelated text unchanged`, () => {
    const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    const source = readFileSync(path, "utf8");
    assert.equal(before.split(old).length, 2);
    assert.equal(source, before.replace(old, corrected));
    assert.deepEqual(eventAttributes(source), eventAttributes(before));
  });
test("Usage destination exists and canonical word-counter catalog has truthful neutral description", () => {
  assert.match(
    readFileSync("src/components/SettingsDialog.tsx", "utf8"),
    /v: "usage",\s+label: "Usage"/,
  );
  const { getWritingTool } = loadUiModule("src/lib/writing-tool-catalog.ts", {});
  const counter = getWritingTool("word-counter");
  assert.equal(
    counter.shortDescription,
    "Count words, characters, sentences, and lines in your browser.",
  );
  assert.equal(counter.action, "count");
  assert.equal(counter.supportsSettings, false);
});
test("Word-counter execution and active-section tracking remain byte-identical", () => {
  for (const path of [
    "src/components/writing/WritingToolWorkspace.tsx",
    "src/lib/legal-active-section.ts",
    "src/components/public/LegalDoc.tsx",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
});
