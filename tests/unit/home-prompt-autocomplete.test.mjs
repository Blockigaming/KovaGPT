import assert from "node:assert/strict";
import test from "node:test";
import { homePromptSuggestions } from "../../src/lib/home-prompt-autocomplete.mjs";

const history = [
  {
    updatedAt: 2,
    messages: [
      { role: "user", content: "How to review a project", requestedTool: "web_search" },
      { role: "assistant", content: "How to read assistant text" },
      { role: "user", content: "How to reset a password" },
    ],
  },
  {
    updatedAt: 3,
    temporary: true,
    messages: [{ role: "user", content: "How to read a private temporary note" }],
  },
];

test("completions match the draft and prefer recent owner history and connected capabilities", () => {
  const suggestions = homePromptSuggestions("how to", history, [], ["github"]);
  assert.equal(suggestions[0], "how to review a project");
  assert.ok(suggestions.includes("how to review a GitHub repository"));
  assert.ok(suggestions.every((item) => item.startsWith("how to")));
  assert.ok(!suggestions.some((item) => /assistant text|password|temporary/.test(item)));
  assert.ok(suggestions.length <= 5);
});

test("memory titles participate without using raw note bodies", () => {
  assert.equal(
    homePromptSuggestions("Plan my", [], [{ title: "Plan my project milestones" }])[0],
    "Plan my project milestones",
  );
});

test("empty and sensitive drafts stay quiet and unconnected apps are not suggested", () => {
  assert.deepEqual(homePromptSuggestions(""), []);
  assert.deepEqual(homePromptSuggestions("api key"), []);
  assert.deepEqual(homePromptSuggestions("Find my documents in OneDrive"), []);
  assert.deepEqual(homePromptSuggestions("unrelated text", history), []);
});
