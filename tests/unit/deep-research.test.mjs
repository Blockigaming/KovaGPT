import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  conversationStorageKey,
  loadConversations,
  normalizeResearchProgress,
} from "../../src/lib/chat-store.ts";
import { applyResearchDelta } from "../../src/lib/deep-research-client.ts";

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
  assert.match(store, /label: "Research canceled"/);
  assert.match(progressCard, /aria-label="Deep Research progress"/);
  assert.match(progressCard, /role="progressbar"/);
  assert.match(
    message,
    /streaming && !message\.content && !message\.pendingImage && !message\.researchProgress/,
  );
  assert.match(message, /waitingForFirstToken \?/);
  assert.match(client, /activity\.status === "running"/);
  assert.match(route, /markAssistantStopped\(conversation\.messages, target\.assistantMessageId\)/);
  assert.match(store, /Research interrupted/);
  assert.match(store, /Array\.isArray\(candidate\.warnings\)/);
  assert.match(store, /researchProgress\?: ResearchProgress/);
});

test("deep research closes comparison and preserves failure activity states", () => {
  const research = read("src/lib/ai/deep-research.server.ts");
  const route = read("src/routes/index.tsx");
  const message = read("src/components/ChatMessage.tsx");
  assert.match(research, /"compare_sources", "Source comparison complete", "complete"/);
  assert.match(route, /delta\.status === "failed" \|\| delta\.status === RESEARCH_CANCELED/);
  assert.match(message, /activity\.status === "failed"/);
  assert.match(message, /activity\.status === "canceled"/);
  assert.match(research, /if \(workflowComplete\) throw error/);
});

test("intermediate completed stages remain globally running", () => {
  const message = {
    id: "assistant",
    role: "assistant",
    content: "",
    activities: [{ tool: "research_plan", label: "Planning", status: "running" }],
  };
  const intermediate = applyResearchDelta(message, {
    kind: "research_progress",
    stage: "planning",
    label: "Research plan ready",
    status: "complete",
    progress: 0.2,
  });
  assert.equal(intermediate.researchProgress.status, "running");
  assert.equal(intermediate.activities[0].status, "running");

  const finished = applyResearchDelta(intermediate, {
    kind: "research_progress",
    stage: "complete",
    label: "Research complete",
    status: "complete",
    progress: 1,
  });
  assert.equal(finished.researchProgress.status, "complete");
  assert.equal(finished.activities[0].status, "done");
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
  assert.match(route, /m\.requestedTool \?\? \(m\.researchProgress \? "deep_research" : null\)/);
});

test("deep research rejects attachments before starting and at the API boundary", () => {
  const composer = read("src/components/ChatInput.tsx");
  const chat = read("src/routes/api/chat.ts");
  assert.match(composer, /selectedToolRef\.current === "deep_research" && attachments\.length > 0/);
  assert.match(composer, /Deep Research doesn't support attachments yet/);
  assert.match(chat, /clientTool === "deep_research" && currentAttachments\.length > 0/);
  assert.match(chat, /category: "invalid_request"/);
  assert.match(chat, /retryable: false/);
  assert.ok(
    chat.indexOf('clientTool === "deep_research" && currentAttachments.length > 0') <
      chat.indexOf('preflight.run("chat_quota"'),
    "unsupported research attachments must be rejected before quota reservation",
  );
});

test("canceled and interrupted progress-only research remains actionable", () => {
  const route = read("src/routes/index.tsx");
  const message = read("src/components/ChatMessage.tsx");
  const progressCard = read("src/components/ResearchProgressCard.tsx");
  const store = read("src/lib/chat-store.ts");
  assert.match(store, /activity\.status === "running"[\s\S]{0,100}status: "canceled"/);
  assert.match(route, /markAssistantStopped/);
  assert.match(message, /onRetry=\{onRetry\}/);
  assert.match(progressCard, /aria-label="Retry Deep Research"/);
  assert.match(progressCard, /progress\.status !== "complete" && onRetry/);
});
