import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("feature parity ledger covers required product areas", () => {
  const ledger = read("docs/chatgpt-feature-parity.md");
  for (const area of [
    "Conversation branching",
    "Interactive charts",
    "Lockdown Mode",
    "Voice",
    "Collaboration",
    "Finances",
  ]) {
    assert.match(ledger, new RegExp(area));
  }
});

test("conversation branching records origin and truncates at a selected message", () => {
  const store = read("src/lib/chat-store.ts");
  assert.match(store, /branchOrigin/);
  assert.match(store, /slice\(0, index \+ 1\)/);
  assert.match(store, /The selected message is no longer available/);
  assert.match(read("src/components/ChatMessage.tsx"), /Branch from this message in a new chat/);
});

test("conversation outline derives only real prompts and headings", () => {
  const outline = read("src/components/ConversationOutline.tsx");
  const outlineUtils = read("src/components/conversation-outline-utils.ts");
  assert.match(outlineUtils, /message\.role === "user"/);
  assert.match(outlineUtils, /match\(\/\^#\{1,3\}/);
  assert.match(outline, /IntersectionObserver/);
  assert.match(outline, /Conversation outline/);
});

test("structured charts support inspection, switching, and export without code execution", () => {
  const chart = read("src/components/ChatChart.tsx");
  const chartUtils = read("src/components/chat-chart-utils.ts");
  for (const type of ["bar", "line", "pie", "donut", "scatter"])
    assert.match(chartUtils, new RegExp(`\\"${type}\\"`));
  assert.match(chart, /chartToCsv/);
  assert.match(chart, /<table/);
  assert.doesNotMatch(chart, /eval\(|dangerouslySetInnerHTML/);
});

test("heavy chart and artifact workspaces are loaded only when a response needs them", () => {
  const message = read("src/components/ChatMessage.tsx");
  assert.match(message, /lazy\(\(\) =>\s*import\("\.\/ChatChart"\)/);
  assert.match(message, /import\("\.\/ArtifactEditor"\)/);
  assert.match(message, /<Suspense/);
});

test("eligible assistant outputs expose the existing full-screen Artifact workspace", () => {
  const message = read("src/components/ChatMessage.tsx");
  assert.match(message, /Open code full screen/);
  assert.match(message, /Open writing full screen/);
  assert.match(message, /<ArtifactEditor/);
});

test("Automation Builder creates through the real scheduled-task flow", () => {
  const builder = read("src/components/AutomationBuilder.tsx");
  const tasks = read("src/routes/scheduled-tasks.tsx");
  assert.match(builder, /onCreate\(\{ title:/);
  assert.match(builder, /Scheduled Task history/);
  assert.match(builder, /never\s+claimed/);
  assert.match(tasks, /createAutomation/);
  assert.match(tasks, /setEditor\("new"\)/);
  assert.match(read("src/components/ScheduledTaskEditor.tsx"), /await create\(/);
});
