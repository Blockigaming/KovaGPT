import assert from "node:assert/strict";
import test from "node:test";
import {
  groupFailed,
  segmentReply,
  snapToParagraph,
  summarizeActivityGroup,
} from "../../src/lib/activity-groups.mjs";

const step = (tool, label, at, extra = {}) => ({ tool, label, status: "done", at, ...extra });

test("steps sit between the paragraphs they happened around", () => {
  const content = "First paragraph.\n\nSecond paragraph.\n\nThird.";
  const segments = segmentReply(content, [
    step("github_read", "Reviewing PR", 0),
    step("run_command", "Running tests", 25),
  ]);
  assert.deepEqual(
    segments.map((s) => (s.kind === "text" ? s.text : `[${s.activities.length}]`)),
    ["[1]", "First paragraph.\n\n", "[1]", "Second paragraph.\n\nThird."],
  );
});

test("legacy steps without positions keep the old single list", () => {
  assert.equal(segmentReply("Hi", [{ tool: "web_search", label: "x", status: "done" }]), null);
  assert.equal(segmentReply("Hi", []), null);
});

test("a cut never lands inside a code fence", () => {
  const text = "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter";
  const inside = text.indexOf("const b");
  const cut = snapToParagraph(text, inside);
  assert.equal(text.slice(cut).startsWith("```js"), true);
});

test("children follow their parent step in the same group", () => {
  const segments = segmentReply("Done.", [
    step("web_search", "Search", 0, { activityId: "p" }),
    { tool: "fetch", label: "Read page", status: "done", parentId: "p" },
  ]);
  assert.equal(segments[0].activities.length, 2);
});

test("summaries read like a sentence", () => {
  assert.equal(
    summarizeActivityGroup([
      step("github_read", "a", 0),
      step("supabase_query", "b", 0),
      ...Array.from({ length: 7 }, () => step("run_command", "c", 0)),
      step("web_search", "d", 0),
    ]),
    "Used GitHub and Supabase, ran 7 commands, and searched the web",
  );
  assert.equal(
    summarizeActivityGroup([step("read_file", "a", 0), step("run_command", "b", 0)]),
    "Ran 1 command and explored files",
  );
  assert.equal(summarizeActivityGroup([step("read_file", "Searched files", 0)]), "Searched files");
  assert.equal(
    summarizeActivityGroup([
      step("web_search", "Searched", 0),
      { tool: "run_command", label: "Counting accounts", status: "running" },
    ]),
    "Counting accounts",
  );
  assert.equal(groupFailed([step("x", "y", 0, { status: "failed" })]), true);
});
