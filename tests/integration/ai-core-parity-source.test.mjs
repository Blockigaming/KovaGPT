import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("chat API delegates model routing, activity, memory, web search, and failure isolation", () => {
  const chat = read("src/routes/api/chat.ts");
  for (const token of [
    "selectModelForMode",
    "routeDecision.modelId",
    "createToolActivityEvent",
    "selectRelevantMemories",
    "formatMemoryBlock",
    'clientTool === "web_search"',
  ]) {
    assert.match(
      chat,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `chat route should include ${token}`,
    );
  }
  assert.doesNotMatch(chat, /clientTool === "deep_research"/u);
  assert.doesNotMatch(chat, /OPENAI_API_KEY\s*=/);
});

test("web-search responses stream bounded source records to the message UI", () => {
  const chat = read("src/routes/api/chat.ts");
  const home = read("src/routes/index.tsx");
  const message = read("src/components/ChatMessage.tsx");
  const history = read("src/lib/chat-history-policy.mjs");
  const projectChat = read("src/routes/projects.$projectId.chat.$chatId.tsx");
  const styles = read("src/styles/chatgpt-parity.css");

  assert.match(chat, /kind: "web_sources"/u);
  assert.match(chat, /responseSourcesDelta\(webSources\)/u);
  assert.match(home, /normalizeResponseSources\(delta\.sources\)/u);
  assert.match(message, /Sources for this response/iu);
  assert.match(history, /item\.sources = message\.sources\.map\(responseSource\)/u);
  assert.match(projectChat, /normalizeResponseSources\(delta\.sources\)/u);
  assert.match(styles, /button\.kova-message-source-toggle\s*\{[\s\S]*?width: auto/u);
  assert.doesNotMatch(
    chat,
    /if \(!upstream\.ok\)[\s\S]*?start\(controller\) \{\s*if \(webSources\.length\)/u,
  );
  assert.doesNotMatch(message, /if \(sourceActivity\) toast\.message\(sourceActivity\.label\)/u);
});

test("tool activity stream is typed, safe, accessible-ready, and excludes secrets", () => {
  const activity = read("src/lib/ai/activity.server.ts");
  for (const token of [
    "ToolActivityEvent",
    "ToolActivityStatus",
    "search_web",
    "read_source",
    "project_files",
    "memory",
    "research_plan",
    "compare_sources",
    "write_report",
    "image_generation",
    "scrubActivityMetadata",
    "activityToSseDelta",
  ]) {
    assert.match(activity, new RegExp(`\\b${token}\\b`), `activity should include ${token}`);
  }
  assert.match(activity, /token\|secret\|key\|password\|credential\|authorization/i);
});
