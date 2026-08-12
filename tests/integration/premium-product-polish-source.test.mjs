import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("streaming batches token updates and deduplicates activity events", async () => {
  const source = await read("src/routes/index.tsx");
  assert.match(source, /pendingContent \+= chunk/);
  assert.match(source, /requestAnimationFrame\(flushAssistant\)/);
  assert.match(source, /item\.tool === activity\.tool && item\.label === activity\.label/);
  assert.match(source, /item\.actionId === confirmation\.actionId/);
  assert.match(source, /KovaGPT response complete/);
});

test("conversation persistence reconciles duplicates and exposes factual statistics", async () => {
  const source = await read("src/lib/chat-store.ts");
  assert.match(source, /seen\.has\(conversation\.id\)/);
  assert.match(source, /dedupeMessages/);
  assert.match(source, /getConversationStats/);
  assert.match(source, /estimatedTokens: Math\.ceil\(words \* 1\.33\)/);
  assert.match(source, /exportConversationMarkdown/);
  assert.match(source, /Estimated reading time/);
});

test("Markdown rendering is memoized and publication styles remain accessible", async () => {
  const component = await read("src/components/ChatMessage.tsx");
  const styles = await read("src/styles.css");
  assert.match(component, /const MarkdownContent = memo/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(styles, /\.prose-chat :where\(ul, ol\) :where\(ul, ol\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.kova-skeleton::after/);
});

test("remaining native project and Work dialogs are replaced with accessible UI", async () => {
  const projectChat = await read("src/routes/projects.$projectId.chat.$chatId.tsx");
  const collaboration = await read("src/components/ProjectCollaboration.tsx");
  const work = await read("src/routes/work.tsx");
  for (const source of [projectChat, collaboration, work]) {
    assert.doesNotMatch(source, /\b(?:confirm|prompt|alert)\(/);
  }
  assert.match(projectChat, /AlertDialog/);
  assert.match(projectChat, /aria-label="Project chat title"/);
  assert.match(collaboration, /Delete project comment\?/);
  assert.match(work, /aria-label="Deliverable title"/);
});
