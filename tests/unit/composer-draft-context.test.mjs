import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  composerPluginConnection,
  rankConnectedComposerPlugins,
} from "../../src/lib/composer-plugin-usage.mjs";

const source = readFileSync(new URL("../../src/lib/chat-edit-draft.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { beginChatEdit, restoreChatEditDraft, hasPendingChatAttachments } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("editing successive old prompts retains an independent copy of the unsent draft", () => {
  const files = [
    {
      kind: "text_file",
      name: "Draft.txt",
      textContent: "original",
      dataUrl: "",
      status: "complete",
    },
  ];
  const first = beginChatEdit(null, "account-a", "chat-a", "prompt-1", "Unsent text", files);
  files[0].name = "changed";
  const second = beginChatEdit(first, "account-a", "chat-a", "prompt-2", "An edited prompt", []);
  const restored = restoreChatEditDraft(second, "account-a", "chat-a");
  assert.equal(restored.text, "Unsent text");
  assert.equal(restored.attachments[0].name, "Draft.txt");
  restored.attachments[0].name = "modified restore";
  assert.equal(
    restoreChatEditDraft(second, "account-a", "chat-a").attachments[0].name,
    "Draft.txt",
  );
});

test("draft restoration rejects another account or conversation and pending reads block editing", () => {
  const edit = beginChatEdit(null, "account-a", "chat-a", "prompt-1", "Private draft", []);
  assert.equal(restoreChatEditDraft(edit, "account-b", "chat-a"), null);
  assert.equal(restoreChatEditDraft(edit, "account-a", "chat-b"), null);
  assert.equal(hasPendingChatAttachments([{ status: "uploading" }]), true);
  assert.equal(hasPendingChatAttachments([{ status: "selected" }]), true);
  assert.equal(hasPendingChatAttachments([{ status: "complete" }]), false);
});

test("plugin order counts saved read requests once across branches, excluding temporary activity", () => {
  const message = {
    id: "answer",
    role: "assistant",
    activities: [
      { tool: "gmail_search", status: "done" },
      { tool: "gmail_send", status: "done" },
      { tool: "github.file", status: "running" },
    ],
  };
  assert.deepEqual(
    rankConnectedComposerPlugins(
      [
        { messages: [message] },
        { messages: [message] },
        { temporary: true, messages: [{ ...message, id: "temporary" }] },
      ],
      ["github", "gmail"],
    ),
    [
      { id: "gmail", count: 1 },
      { id: "github", count: 0 },
    ],
  );
});

test("a plugin connection never inherits another account's status or incomplete permissions", () => {
  const snapshot = {
    principal: "account-a",
    loading: false,
    google: {
      configured: true,
      connected: true,
      state: "connected",
      has: { gmail: true },
    },
  };
  assert.equal(
    composerPluginConnection("gmail", { userId: "account-b", authLoaded: true, snapshot })
      .connected,
    false,
  );
  assert.equal(
    composerPluginConnection("gmail", { userId: "account-a", authLoaded: true, snapshot }).label,
    "Access unverified",
  );
  assert.equal(
    composerPluginConnection("gmail", { userId: null, authLoaded: true, snapshot }).connected,
    false,
  );
});
