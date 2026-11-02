import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { messageActivitiesFromDelta } from "../../src/lib/message-activity-list.mjs";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("streaming batches tokens and updates matching activity operations without losing later calls", async () => {
  const source = await read("src/routes/index.tsx");
  assert.match(source, /pendingContent \+= chunk/);
  assert.match(source, /requestAnimationFrame\(flushAssistant\)/);
  assert.match(source, /messageActivitiesFromDelta\(message\.activities \?\? \[\], delta\)/);
  const delta = { activity_id: "first", tool: "search_web", label: "Read site", status: "pending" };
  let rows = messageActivitiesFromDelta([], delta);
  rows = messageActivitiesFromDelta(rows, { ...delta, status: "done" });
  rows = messageActivitiesFromDelta(rows, { ...delta, status: "done" });
  rows = messageActivitiesFromDelta(rows, { ...delta, activity_id: "second", status: "done" });
  assert.deepEqual(
    rows.map(({ activityId, status }) => ({ activityId, status })),
    [
      { activityId: "first", status: "done" },
      { activityId: "second", status: "done" },
    ],
  );
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

test("message rendering is memoized and extracted Markdown preserves stable accessible controls", async () => {
  const component = await read("src/components/ChatMessage.tsx");
  const markdown = await read("src/components/ResponseMarkdown.tsx");
  const styles = await read("src/styles.css");
  assert.match(component, /export const ChatMessage = memo\(ChatMessageInner\)/);
  assert.match(component, /import \{ ResponseMarkdown \} from "\.\/ResponseMarkdown"/);
  assert.match(component, /<ResponseMarkdown/);
  assert.match(markdown, /const markdownComponents: Components = \{/);
  assert.match(markdown, /const actions = useMemo\(/);
  assert.match(markdown, /components=\{markdownComponents\}/);
  assert.match(markdown, /aria-hidden="true"/);
  assert.match(markdown, /aria-label="Scrollable comparison table"/);
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
  assert.match(work, /throw redirect/);
});
