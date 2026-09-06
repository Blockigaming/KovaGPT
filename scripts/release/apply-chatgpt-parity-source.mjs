import { readFileSync, writeFileSync } from "node:fs";

const checkOnly = process.argv.includes("--check");

const REQUIRED_COMPOSER_TOOLS = `[
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "deep_research", label: "Deep research", icon: Telescope },
  { id: "image", label: "Create Image", icon: ImagePlus },
]`;

function compactSource(source) {
  return source.replace(/\s+/gu, "");
}

function hasRequiredComposerTools(source) {
  const declaration = source.match(
    /const\s+COMPOSER_TOOLS\s*:\s*readonly\s+ComposerAction\[\]\s*=\s*(\[[\s\S]*?\]);/u,
  );
  return (
    declaration?.[1] != null &&
    compactSource(declaration[1]) === compactSource(REQUIRED_COMPOSER_TOOLS)
  );
}

const replacements = [
  {
    path: "src/components/ChatInput.tsx",
    before: `const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "image", label: "Create Image", icon: ImagePlus },
];`,
    after: `const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "deep_research", label: "Deep research", icon: Telescope },
  { id: "image", label: "Create Image", icon: ImagePlus },
];`,
    isApplied(source) {
      return hasRequiredComposerTools(source);
    },
  },
  {
    path: "src/components/ChatInput.tsx",
    before: `{COMPOSER_TOOLS.map(toolRow)}`,
    after: `{COMPOSER_TOOLS.filter(
          (tool) => tool.id !== "deep_research" || userTier !== "free",
        ).map(toolRow)}`,
    isApplied(source) {
      return /COMPOSER_TOOLS\.filter\(\s*\(tool\)\s*=>\s*tool\.id !== "deep_research" \|\| userTier !== "free",?\s*\)\.map\(\s*toolRow,?\s*\)/u.test(
        source,
      );
    },
  },
  {
    path: "src/components/ChatInput.tsx",
    before: `aria-label="Stop"`,
    after: `aria-label="Stop generating"
                  data-testid="stop-button"`,
    isApplied(source) {
      return /aria-label="Stop generating"\s+data-testid="stop-button"/u.test(source);
    },
  },
  {
    path: "src/components/ChatInput.tsx",
    before: `aria-label="Send"`,
    after: `aria-label="Send message"
                  data-testid="send-button"`,
    isApplied(source) {
      return (
        occurrences(source, 'aria-label="Send message"') === 1 &&
        /aria-label="Send message"\s+data-testid="send-button"/u.test(source)
      );
    },
  },
  {
    path: "src/components/ChatInput.tsx",
    before: `aria-label={blockedAttachmentMessage ?? "Send"}`,
    after: `aria-label={blockedAttachmentMessage ?? "Send message"}
                  data-testid="send-button"`,
    isApplied(source) {
      return /aria-label=\{blockedAttachmentMessage \?\? "Send message"\}\s+data-testid="send-button"/u.test(
        source,
      );
    },
  },
  {
    path: "src/routes/index.tsx",
    before: `              ref={scrollRef}
              onScroll={updateNearBottom}`,
    after: `              ref={scrollRef}
              data-chat-transcript="true"
              onScroll={updateNearBottom}`,
    isApplied(source) {
      return /ref=\{scrollRef\}\s+data-chat-transcript="true"\s+onScroll=\{updateNearBottom\}/u.test(
        source,
      );
    },
  },
  {
    path: "src/routes/index.tsx",
    before: `. Chats may be reviewed and used to improve our AI models.{" "}`,
    after: `. Chats may be processed by configured AI providers and reviewed when needed for safety, support, or reliability.{" "}`,
    isApplied(source) {
      return /Chats may be processed by configured AI providers and reviewed when needed for\s+safety, support, or reliability\./u.test(
        source,
      );
    },
  },
  {
    path: "src/components/Sidebar.tsx",
    before:
      "relative flex h-9 items-center rounded-lg py-1 text-sm transition-colors duration-100 ${iconOnly} ${",
    after:
      "kova-nav-row relative flex h-10 items-center rounded-xl py-1 text-sm transition-colors duration-100 ${iconOnly} ${",
  },
  {
    path: "tests/e2e/parity-helpers.ts",
    before: `sendControl: { chatgpt: "[data-testid='send-button']", kova: "[aria-label='Send message']" },`,
    after: `sendControl: {
    chatgpt: "[data-testid='send-button']",
    kova: "[data-testid='send-button']",
  },`,
    isApplied(source) {
      return /sendControl:\s*\{[\s\S]*?kova: "\[data-testid='send-button'\]"[\s\S]*?\},/u.test(
        source,
      );
    },
  },
];

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function replacementState(source, replacement) {
  const beforeCount = occurrences(source, replacement.before);
  const afterCount = occurrences(source, replacement.after);
  const afterContainsBefore = replacement.after.includes(replacement.before);
  const applied = replacement.isApplied
    ? replacement.isApplied(source)
    : afterCount === 1 && beforeCount === (afterContainsBefore ? 1 : 0);
  const pending = afterCount === 0 && beforeCount === 1;
  return { applied, pending, beforeCount, afterCount };
}

export function applyChatGptParitySource({ check = checkOnly } = {}) {
  const files = new Map();
  const changed = new Set();

  for (const replacement of replacements) {
    const source = files.get(replacement.path) ?? readFileSync(replacement.path, "utf8");
    const state = replacementState(source, replacement);
    if (state.applied) {
      files.set(replacement.path, source);
      continue;
    }
    if (!state.pending) {
      throw new Error(
        `chatgpt_parity_source_drift:${replacement.path}:before=${state.beforeCount}:after=${state.afterCount}`,
      );
    }
    files.set(replacement.path, source.replace(replacement.before, replacement.after));
    changed.add(replacement.path);
  }

  if (check && changed.size) {
    throw new Error(`chatgpt_parity_source_pending:${[...changed].sort().join(",")}`);
  }
  if (!check) {
    for (const path of [...changed].sort()) writeFileSync(path, files.get(path));
  }
  return { changed: [...changed].sort(), check };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = applyChatGptParitySource();
  console.log(
    `CHATGPT_PARITY_SOURCE=${checkOnly ? "PASS" : "APPLIED"} files=${result.changed.join(",") || "none"}`,
  );
}
