import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { nodes, reactFixture, text } from "../helpers/kova-react-fixture.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import * as localWorkspace from "../../src/lib/local-chat-workspace.mjs";
import * as revisionDiff from "../../src/lib/result-revision-diff.mjs";

const diffPath = fileURLToPath(
  new URL("../../src/components/ResponseVersionDiff.tsx", import.meta.url),
);
const historyPath = fileURLToPath(
  new URL("../../src/components/MessageVersionHistoryDialog.tsx", import.meta.url),
);
const { ResponseVersionDiff } = loadUiModule(diffPath, {
  react: { useMemo: (run) => run() },
  "@/lib/result-revision-diff.mjs": revisionDiff,
});

function memoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
}

function historyFixture({ rows = [], signedIn = true, accept, list, ...initialProps } = {}) {
  const calls = { list: [], accept: [], restore: [], open: [] };
  const storage = memoryStorage();
  const listMessageVersions = async (input) => {
    calls.list.push(structuredClone(input));
    return list ? list(input) : rows;
  };
  const acceptMessageVersion = async (input) => {
    calls.accept.push(structuredClone(input));
    return accept?.(input);
  };
  const props = {
    open: true,
    chatId: "chat-a",
    messageId: "response-a",
    currentContent: "Shared heading\nCurrent paragraph\nShared ending\n",
    onRestore: (content) => calls.restore.push(content),
    onOpenChange: (open) => calls.open.push(open),
    ...initialProps,
  };
  const fixture = reactFixture(
    historyPath,
    (exports) => () => exports.MessageVersionHistoryDialog(props),
    {
      modules: {
        "lucide-react": { Loader2: "loader-icon", RotateCcw: "restore-icon" },
        "@tanstack/react-start": { useServerFn: (fn) => fn },
        "@/components/ui/dialog": {
          Dialog: "dialog",
          DialogContent: "dialog-content",
          DialogDescription: "dialog-description",
          DialogHeader: "dialog-header",
          DialogTitle: "dialog-title",
        },
        "@/components/auth/ClerkSafe": { useUser: () => ({ isSignedIn: signedIn }) },
        "@/lib/chat-workspace.functions": { listMessageVersions, acceptMessageVersion },
        "@/lib/local-chat-workspace.mjs": localWorkspace,
        "@/lib/principal-browser-storage.mjs": { safeBrowserStorage: () => storage },
        "./ResponseVersionDiff": { ResponseVersionDiff },
      },
    },
  );
  return { fixture, props, calls, storage };
}

const entry = (version, content) => ({
  id: `saved-${version}`,
  version,
  content,
  instruction: `Edit ${version}`,
  createdAt: "2026-10-21T12:00:00.000Z",
});
const rowFor = (fixture, version) =>
  fixture.nodes().find((node) => node.type === "li" && text(node).startsWith(`Version ${version}`));
const rowButton = (row, label) =>
  nodes(row).find((node) => node.type === "button" && text(node) === label);
const comparisons = (fixture) =>
  fixture.nodes().filter((node) => node.type === ResponseVersionDiff);

test("the real revision helper preserves unchanged lines and round-trips both saved texts", () => {
  const before = "Shared heading\nPrevious paragraph\nShared ending\n";
  const after = "Shared heading\nCurrent paragraph\nShared ending\n";
  const chunks = revisionDiff.resultRevisionDiff(before, after);
  assert.deepEqual(chunks, [
    { kind: "unchanged", before: "Shared heading\n", after: "Shared heading\n" },
    { kind: "change", before: "Previous paragraph\n", after: "Current paragraph\n" },
    { kind: "unchanged", before: "Shared ending\n", after: "Shared ending\n" },
  ]);
  assert.equal(revisionDiff.applyReviewedDiff(chunks), after);
  assert.equal(revisionDiff.applyReviewedDiff(chunks, [1]), before);
  for (const [oldText, newText] of [
    ["", "Added\n"],
    ["Removed\n", ""],
    ["Same", "Same"],
  ]) {
    const delta = revisionDiff.resultRevisionDiff(oldText, newText);
    assert.equal(delta.map((chunk) => chunk.before).join(""), oldText);
    assert.equal(delta.map((chunk) => chunk.after).join(""), newText);
  }
});

test("ResponseVersionDiff renders real changed and unchanged text as inert React children", async () => {
  const before = "Shared\n<script>previous()</script>\nEnding\n";
  const after = "Shared\n<img src=x onerror=current()>\nEnding\n";
  const fixture = reactFixture(
    diffPath,
    (exports) => () => exports.ResponseVersionDiff({ before, after }),
    {
      modules: { "@/lib/result-revision-diff.mjs": revisionDiff },
    },
  );
  await fixture.flush();
  assert.equal(
    text(fixture.find("p", (node) => node.props.role === "status")),
    "1 changed section",
  );
  assert.equal(text(fixture.find("del")), "<script>previous()</script>\n");
  assert.equal(text(fixture.find("ins")), "<img src=x onerror=current()>\n");
  const unchanged = fixture
    .nodes()
    .filter(
      (node) =>
        node.type === "pre" && !nodes(node).some((child) => ["ins", "del"].includes(child.type)),
    );
  assert.deepEqual(unchanged.map(text), ["Shared\n", "Ending\n"]);
  assert.ok(fixture.nodes().every((node) => !Object.hasOwn(node.props, "dangerouslySetInnerHTML")));
  assert.ok(fixture.nodes().every((node) => !["script", "img", "iframe"].includes(node.type)));
});

test("ResponseVersionDiff states no changes without inventing a previous version", async () => {
  const fixture = reactFixture(
    diffPath,
    (exports) => () => exports.ResponseVersionDiff({ before: "Unchanged\n", after: "Unchanged\n" }),
    {
      modules: { "@/lib/result-revision-diff.mjs": revisionDiff },
    },
  );
  await fixture.flush();
  assert.equal(text(fixture.find("p", (node) => node.props.role === "status")), "No changes");
  assert.equal(text(fixture.find("pre")), "Unchanged\n");
  assert.equal(fixture.nodes().filter((node) => ["del", "ins"].includes(node.type)).length, 0);
});

test("compareInitially previews the newest actual saved alternative without restoring or writing", async () => {
  const current = "Shared heading\nCurrent paragraph\nShared ending\n";
  const previous = "Shared heading\nPrevious paragraph\nShared ending\n";
  const { fixture, calls, storage } = historyFixture({
    compareInitially: true,
    rows: [entry(1, "Oldest draft"), entry(2, previous), entry(3, current)],
  });
  await fixture.flush();
  assert.match(fixture.text(), /Compare response versions/);
  assert.deepEqual(calls.list, [{ data: { chatId: "chat-a", messageId: "response-a" } }]);
  assert.equal(comparisons(fixture).length, 1);
  const comparison = comparisons(fixture)[0];
  assert.deepEqual(structuredClone(comparison.props), { before: previous, after: current });
  const actualDiff = ResponseVersionDiff(comparison.props);
  assert.equal(text(nodes(actualDiff).find((node) => node.type === "del")), "Previous paragraph\n");
  assert.equal(text(nodes(actualDiff).find((node) => node.type === "ins")), "Current paragraph\n");
  assert.equal(rowButton(rowFor(fixture, 2), "Hide preview").props["aria-expanded"], true);
  assert.equal(rowButton(rowFor(fixture, 2), "Restore").props.disabled, false);
  assert.equal(rowButton(rowFor(fixture, 3), "Restore").props.disabled, true);
  assert.deepEqual(calls.accept, []);
  assert.deepEqual(calls.restore, []);
  assert.deepEqual(calls.open, []);
  assert.deepEqual(storage.writes, []);
});

test("normal history requires explicit preview, then restore accepts exactly the selected saved version", async () => {
  const previous = "An actual previous response\n";
  const { fixture, calls } = historyFixture({ rows: [entry(1, previous)] });
  await fixture.flush();
  assert.match(fixture.text(), /Version history/);
  assert.equal(comparisons(fixture).length, 0);
  assert.equal(rowButton(rowFor(fixture, 1), "Restore").props.disabled, true);
  await fixture.click("Preview version");
  assert.equal(comparisons(fixture).length, 1);
  assert.equal(text(fixture.find("pre")), previous);
  assert.deepEqual(calls.accept, []);
  await fixture.click("Restore");
  assert.deepEqual(calls.accept, [{ data: { versionId: "saved-1" } }]);
  assert.deepEqual(calls.restore, [previous]);
  assert.deepEqual(calls.open, [false]);
  assert.deepEqual(fixture.messages, [["success", "Restored version 1"]]);
});

test("a failed saved-version restore reports the service failure without changing the response or closing", async () => {
  const { fixture, calls } = historyFixture({
    rows: [entry(1, "Previous response")],
    compareInitially: true,
    accept: async () => {
      throw new Error("Version is no longer available to this account.");
    },
  });
  await fixture.flush();
  await fixture.click("Restore");
  assert.equal(
    text(fixture.find("p", (node) => node.props.role === "alert")),
    "Version is no longer available to this account.",
  );
  assert.deepEqual(calls.restore, []);
  assert.deepEqual(calls.open, []);
  assert.deepEqual(fixture.messages, []);
});

test("guest comparisons use the real device history and restore appends a labeled local version", async () => {
  const previous = "Previous local response\n";
  const { fixture, props, calls, storage } = historyFixture({
    signedIn: false,
    compareInitially: true,
  });
  localWorkspace.saveLocalVersion(storage, "chat-a", "response-a", {
    content: previous,
    source: "inline_edit",
  });
  storage.writes.length = 0;
  await fixture.flush();
  assert.match(fixture.text(), /this device only/);
  assert.equal(comparisons(fixture)[0].props.before, previous);
  assert.deepEqual(storage.writes, []);
  await fixture.click("Restore");
  assert.deepEqual(calls.list, []);
  assert.deepEqual(calls.accept, []);
  assert.deepEqual(calls.restore, [previous]);
  assert.deepEqual(calls.open, [false]);
  const saved = localWorkspace.localVersions(storage, "chat-a", "response-a");
  assert.equal(saved.length, 2);
  assert.equal(saved[0].content, previous);
  assert.equal(saved[1].content, previous);
  assert.equal(saved[1].originalContent, props.currentContent);
  assert.equal(saved[1].source, "restore");
  assert.equal(saved[1].instruction, "Restored version 1");
  assert.deepEqual(fixture.messages, [["success", "Restored from this device"]]);
});

test("missing response identifiers and an empty history never fabricate a comparison or a restore", async () => {
  for (const props of [{ chatId: null, messageId: null }, {}]) {
    const { fixture, calls } = historyFixture({ ...props, compareInitially: true });
    await fixture.flush();
    assert.match(fixture.text(), /No saved edits for this response yet/);
    assert.equal(comparisons(fixture).length, 0);
    assert.equal(
      fixture.nodes().filter((node) => node.type === "button" && text(node) === "Restore").length,
      0,
    );
    assert.equal(calls.list.length, props.chatId === null ? 0 : 1);
    assert.deepEqual(calls.accept, []);
  }
});

function descendants(root, predicate) {
  const result = [];
  const visit = (node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

test("the schema instruction stays in final API content across isolated workflow and Free planning", () => {
  // This source guard verifies prompt construction, not live model/backend acceptance.
  const path = new URL("../../src/routes/api/chat.ts", import.meta.url);
  const source = ts.createSourceFile(
    "chat.ts",
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = descendants(source, ts.isVariableDeclaration);
  const declaration = (name) =>
    declarations.find((node) => ts.isIdentifier(node.name) && node.name.text === name);
  const property = (object, name) =>
    object.properties.find((node) => node.name?.getText(source) === name);
  const instructionRefs = descendants(
    source,
    (node) => ts.isIdentifier(node) && node.text === "GENERATIVE_UI_INSTRUCTIONS",
  );
  assert.equal(instructionRefs.length, 2, "one import and one final-system content reference");
  assert.ok(ts.isImportSpecifier(instructionRefs[0].parent));
  const body = declaration("body").initializer;
  assert.ok(ts.isObjectLiteralExpression(body));
  const messages = property(body, "messages").initializer;
  assert.ok(ts.isArrayLiteralExpression(messages));
  const systemMessage = messages.elements[0];
  assert.equal(property(systemMessage, "role").initializer.text, "system");
  const systemContent = property(systemMessage, "content").initializer;
  assert.equal(descendants(systemContent, (node) => node === instructionRefs[1]).length, 1);
  assert.match(declaration("finalMessages").initializer.getText(source), /^body\.messages\s+as /);
  const planner = declaration("toolPlanningMessages").initializer;
  assert.ok(ts.isConditionalExpression(planner));
  assert.equal(planner.condition.getText(source), "workflowSkill");
  const ordinaryPlanner = planner.whenFalse;
  assert.ok(ts.isConditionalExpression(ordinaryPlanner));
  assert.equal(ordinaryPlanner.condition.getText(source), "freeConnectorRequest");
  assert.equal(
    ordinaryPlanner.whenFalse.getText(source),
    "finalMessages",
    "ordinary paid planning keeps the complete existing context",
  );
  assert.ok(ts.isArrayLiteralExpression(ordinaryPlanner.whenTrue));
  assert.match(
    ordinaryPlanner.whenTrue.getText(source),
    /FREE_CONNECTOR_PLANNING_INSTRUCTION[\s\S]*\.\.\.finalMessages\.slice\(1\)/,
    "Free planning keeps the conversation after its compact authoritative instructions",
  );
  assert.equal(
    descendants(
      planner,
      (node) => ts.isIdentifier(node) && node.text === "GENERATIVE_UI_INSTRUCTIONS",
    ).length,
    0,
  );
  // Bind the reviewed workflow and bounded Free planner structure. Whitespace
  // and comments do not matter; provenance isolation and planning text do.
  const normalized = ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Expression, planner, source);
  assert.equal(
    createHash("sha256").update(normalized).digest("hex"),
    "672ea45e0cf4777defe0d67f6abafe36a597b823a498469c13bceb05c33bff1b",
  );
  assert.equal(
    declaration("workingMessages").initializer.getText(source),
    "[...toolPlanningMessages]",
  );
});
