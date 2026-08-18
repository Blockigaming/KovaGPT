import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { applyChatGptParitySource } from "../../scripts/release/apply-chatgpt-parity-source.mjs";

const fixtures = {
  "src/components/ChatInput.tsx": `const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the Web", icon: Globe },
  { id: "image", label: "Create Image", icon: ImagePlus },
];
{COMPOSER_TOOLS.map(toolRow)}
aria-label="Stop"
aria-label="Send"
aria-label={blockedAttachmentMessage ?? "Send"}`,
  "src/routes/index.tsx": `              ref={scrollRef}
              onScroll={updateNearBottom}
. Chats may be reviewed and used to improve our AI models.{" "}`,
  "src/components/Sidebar.tsx": `\`relative flex h-9 items-center rounded-lg py-1 text-sm transition-colors duration-100 \${iconOnly} \${\``,
  "tests/e2e/parity-helpers.ts": `sendControl: { chatgpt: "[data-testid='send-button']", kova: "[aria-label='Send message']" },`,
};

test("ChatGPT parity transformer is exact and idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-parity-transform-"));
  const previous = process.cwd();
  try {
    for (const [path, source] of Object.entries(fixtures)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    process.chdir(root);
    const first = applyChatGptParitySource({ check: false });
    assert.deepEqual(first.changed, Object.keys(fixtures).sort());
    assert.match(readFileSync("src/components/ChatInput.tsx", "utf8"), /deep_research/u);
    assert.match(
      readFileSync("src/components/ChatInput.tsx", "utf8"),
      /data-testid="send-button"/u,
    );
    assert.match(readFileSync("src/routes/index.tsx", "utf8"), /data-chat-transcript/u);
    assert.match(readFileSync("src/components/Sidebar.tsx", "utf8"), /kova-nav-row/u);
    assert.deepEqual(applyChatGptParitySource({ check: true }).changed, []);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ChatGPT parity transformer fails closed on source drift", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-parity-drift-"));
  const previous = process.cwd();
  try {
    for (const [path, source] of Object.entries(fixtures)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        path.endsWith("ChatInput.tsx") ? source.replace("Search the Web", "Web") : source,
      );
    }
    process.chdir(root);
    assert.throws(() => applyChatGptParitySource({ check: false }), /source_drift/u);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
