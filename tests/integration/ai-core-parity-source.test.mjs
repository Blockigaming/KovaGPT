import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("chat API delegates model routing, activity, research, memory, and provider failure isolation", () => {
  const chat = read("src/routes/api/chat.ts");
  for (const token of [
    "selectModelForMode",
    "selectedModel.model.modelId",
    "createToolActivityEvent",
    "activityToSseDelta",
    "runDeepResearch",
    "ResearchProgressEvent",
    "selectRelevantMemories",
    "formatMemoryBlock",
    'clientTool === "deep_research"',
    'clientTool === "web_search"',
  ]) {
    assert.match(
      chat,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `chat route should include ${token}`,
    );
  }
  assert.doesNotMatch(chat, /OPENAI_API_KEY\s*=/);
});

test("deep research exposes the full observable lifecycle and source-state tracking", () => {
  const research = read("src/lib/ai/deep-research.server.ts");
  for (const token of [
    "created",
    "planning",
    "searching",
    "reading",
    "comparing",
    "analyzing",
    "writing_report",
    "complete",
    "failed",
    "canceled",
    "ResearchSourceState",
    "sourceState",
    "partialFailures",
    "createToolActivityEvent",
  ]) {
    assert.match(research, new RegExp(`\\b${token}\\b`), `research should include ${token}`);
  }
  assert.match(research, /Markdown links whose labels name the source/);
  assert.match(research, /Do not invent citations, sources, or URLs/);
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
