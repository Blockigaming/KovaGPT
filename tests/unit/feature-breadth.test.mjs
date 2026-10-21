import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("final-goal contract covers required product areas", () => {
  const ledger = read("docs/chatgpt-feature-parity.md");
  const contract = JSON.parse(read("docs/release/final-goal-contract.json"));
  const requirementTitles = contract.requirements
    .map((requirement) => requirement.title)
    .join("\n");

  assert.equal(contract.requirements.length, 21);
  assert.equal(contract.voiceRequired, true);
  for (const area of [
    "Conversation, models, and reasoning",
    "Files, data analysis, and generated artifacts",
    "Identity, safety, privacy, and user control",
    "Live voice and audio",
    "Sharing and collaboration",
    "Plans, entitlements, billing, and premium compute",
  ]) {
    assert.match(requirementTitles, new RegExp(area));
  }
  assert.match(ledger, /independent product, not a visual clone/);
  assert.match(ledger, /owner-declared \*\*76\.5%\*\*/);
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

test("eligible assistant outputs open the Result workspace with their original context", () => {
  const message = read("src/components/ChatMessage.tsx");
  assert.match(message, /Open code result/);
  assert.match(message, /Open writing result/);
  assert.match(message, /<ArtifactEditor/);
  const opener = message.slice(
    message.indexOf("const openResult ="),
    message.indexOf("const openResult =") + 1200,
  );
  assert.match(opener, /onOpenResult\(/);
  for (const field of ["chatId", "messageId", "projectId"])
    assert.match(opener, new RegExp(String.raw`${field}: temporary \? null :`));
  const route = read("src/routes/index.tsx");
  assert.match(route, /<ArtifactEditor[\s\S]*?\{\.\.\.result\}[\s\S]*?embedded/);
  assert.match(
    route,
    /resultPrincipalRef\.current !== storagePrincipal[\s\S]*?resultDraftsRef\.current\.clear\(\)/,
  );
  assert.match(route, /const scope = `\$\{storagePrincipal\}:\$\{activeId \?\? "new"\}`/);
});

test("Automation Builder creates through the real scheduled-task flow", () => {
  const builder = read("src/components/AutomationBuilder.tsx");
  const tasks = read("src/routes/scheduled-tasks.tsx");
  assert.match(builder, /onCreate\(\{ title:/);
  assert.match(builder, /Scheduled Task history/);
  assert.match(builder, /never\s+claimed/);
  assert.match(tasks, /createAutomation/);
  assert.match(tasks, /const createAutomation[\s\S]*?openTaskEditor\("new", "settings", null\)/);
  assert.match(
    tasks,
    /const openTaskEditor[\s\S]*?dataGeneration !== generationRef\.current[\s\S]*?setEditor\(task\)/,
  );
  assert.match(read("src/components/ScheduledTaskEditor.tsx"), /await create\(/);
});
