import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  conversationStorageKey,
  loadConversations,
  normalizeResearchProgress,
} from "../../src/lib/chat-store.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("deep research module defines a multi-stage workflow", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  for (const token of [
    "ResearchStage",
    "ResearchEvidence",
    "ResearchResult",
    "makePlan",
    "searchWeb",
    "buildEvidence",
    "writeReport",
    "runDeepResearch",
    "partialFailures",
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `deep research should include ${token}`);
  }
  assert.match(source, /status: canceled \? "canceled" : "failed"/);
  assert.match(source, /if \(opts\.signal\?\.aborted\) throw error/);
});

test("deep research reports are instructed to use evidence citations only", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  assert.match(source, /provided evidence only/);
  assert.match(source, /Markdown links whose labels name the source/);
  assert.match(source, /URLs exactly match the evidence/);
  assert.match(source, /Do not invent citations, sources, or URLs/);
});

test("chat route has a separate deep research execution path", () => {
  const chat = read("src/routes/api/chat.ts");
  assert.match(chat, /@\/lib\/ai\/deep-research\.server/);
  assert.match(chat, /clientTool === "deep_research"/);
  assert.match(chat, /kind: "research_progress"/);
  const research = read("src/lib/ai/deep-research.server.ts");
  assert.match(research, /"Research could not complete"/);
  assert.match(research, /"Research canceled"/);
});

test("chat UI consumes and renders Deep Research lifecycle events", () => {
  const route = read("src/routes/index.tsx");
  const message = read("src/components/ChatMessage.tsx");
  const progressCard = read("src/components/ResearchProgressCard.tsx");
  const client = read("src/lib/deep-research-client.ts");
  const store = read("src/lib/chat-store.ts");
  assert.match(route, /delta\?\.kind === "research_progress"/);
  assert.match(route, /delta\?\.kind === "research_warning"/);
  assert.match(route, /label: "Research canceled"/);
  assert.match(progressCard, /aria-label="Deep Research progress"/);
  assert.match(progressCard, /role="progressbar"/);
  assert.match(message, /streaming && !message\.content && !message\.researchProgress/);
  assert.match(client, /activity\.status === "running"/);
  assert.match(route, /message\.researchProgress\?\.status === "canceled"/);
  assert.match(route, /activity\.status === "running"[\s\S]*status: "canceled" as const/);
  assert.match(route, /retryTool === "deep_research" && atts\.length/);
  assert.match(
    message,
    /ResearchProgressCard progress={message\.researchProgress} onRetry={onRetry}/,
  );
  assert.match(progressCard, /aria-label="Retry Deep Research"/);
  assert.match(store, /Research interrupted/);
  assert.match(store, /Array\.isArray\(candidate\.warnings\)/);
  assert.match(store, /researchProgress\?: ResearchProgress/);
});

test("deep research closes comparison and preserves failure activity states", () => {
  const research = read("src/lib/ai/deep-research.server.ts");
  const route = read("src/routes/index.tsx");
  const message = read("src/components/ChatMessage.tsx");
  assert.match(research, /"compare_sources", "Source comparison complete", "complete"/);
  assert.match(route, /delta\.status === "failed" \|\| delta\.status === "canceled"/);
  assert.match(message, /activity\.status === "failed"/);
  assert.match(message, /activity\.status === "canceled"/);
  assert.match(research, /if \(workflowComplete\) throw error/);
});

test("restored research progress is bounded and interrupted safely", () => {
  assert.deepEqual(
    normalizeResearchProgress(
      {
        stage: "searching",
        label: "Searching",
        status: "running",
        progress: 2,
        warnings: [" valid warning ", 42, { unsafe: true }],
      },
      true,
    ),
    {
      stage: "searching",
      label: "Research interrupted",
      status: "failed",
      detail: "This research stopped when the page reloaded. Retry to continue.",
      progress: 1,
      warnings: ["valid warning"],
    },
  );
  assert.equal(
    normalizeResearchProgress({
      stage: "searching",
      label: "Searching",
      status: "running",
      progress: "invalid",
    }),
    undefined,
  );
});

test("reload terminalizes running research activities", () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  globalThis.window = { localStorage: storage };
  globalThis.localStorage = storage;
  records.set(
    conversationStorageKey("research-user"),
    JSON.stringify([
      {
        id: "conversation",
        title: "Research",
        mode: "thinking",
        createdAt: 1,
        updatedAt: 2,
        messages: [
          {
            id: "assistant",
            role: "assistant",
            content: "",
            researchProgress: {
              stage: "searching",
              label: "Searching",
              status: "running",
              progress: 0.4,
            },
            activities: [
              { tool: "search_web", label: "Searching web", status: "running" },
              { tool: "research_plan", label: "Plan ready", status: "done" },
            ],
          },
        ],
      },
    ]),
  );
  try {
    const [restored] = loadConversations("research-user");
    assert.equal(restored.messages[0].researchProgress.status, "failed");
    assert.deepEqual(
      restored.messages[0].activities.map((activity) => activity.status),
      ["failed", "done"],
    );
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

test("deep research selection and retry mode are race-safe", () => {
  const route = read("src/routes/index.tsx");
  const composer = read("src/components/ChatInput.tsx");
  assert.match(composer, /onSubmit\(selectedToolRef\.current\)/);
  assert.match(composer, /selectedToolRef\.current = next/);
  assert.match(route, /m\.researchProgress \? "deep_research" : null/);
});
