import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { splitGenerativeContent } from "../../src/lib/generative-ui.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

// Execute the route's actual callbacks/effect and the message's actual widget
// openers. This is synthetic state evidence, not browser or visual acceptance.
function parse(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function find(root, predicate) {
  let found;
  function visit(node) {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(root);
  assert.ok(found, "Expected current Canvas implementation");
  return found;
}
const route = parse("src/routes/index.tsx");
const message = parse("src/components/ChatMessage.tsx");
const openResult = find(
  route,
  (node) => ts.isVariableDeclaration(node) && node.name.getText(route) === "openResult",
).initializer.getText(route);
const autoWorkspace = find(
  route,
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(route) === "useEffect" &&
    node.arguments[0]?.getText(route).includes("pendingCanvasRef.current") &&
    node.arguments[0]?.getText(route).includes("splitGenerativeContent"),
).arguments[0].getText(route);
function widgetAttribute(root, name, includes) {
  const canvas = find(
    root,
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(root) === "GenerativeCanvas" &&
      node.getText(root).includes(includes),
  );
  return find(
    canvas,
    (node) => ts.isJsxAttribute(node) && node.name.getText(root) === name,
  ).initializer.expression.getText(root);
}
const routeCanvasOpener = find(
  route,
  (node) =>
    ts.isJsxAttribute(node) &&
    node.name.getText(route) === "onOpenCanvas" &&
    node.getText(route).includes("canvasSourceKey: sourceKey"),
).initializer.expression.getText(route);
const compiled = ts.transpileModule(
  `
globalThis.bindOpenResult = (nextPromptScope) => (${openResult});
globalThis.bindRouteCanvasOpener = () => (${routeCanvasOpener});
globalThis.bindMessageCanvasOpener = (message, index, part) => (${widgetAttribute(message, "onOpenCanvas", "onOpenCanvas")});
globalThis.bindMessageEditorOpener = (message, index, part) => (${widgetAttribute(message, "onOpenEditor", "onOpenEditor")});
globalThis.runAutoWorkspace = ${autoWorkspace};
`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

const board = (title = "Project", cardTitle = "First card") => ({
  version: 1,
  type: "board",
  title,
  columns: [{ id: "todo", title: "To do" }],
  cards: [{ id: "card-a", title: cardTitle, columnId: "todo" }],
});
const fence = (widget) => `\`\`\`kova-ui\n${JSON.stringify(widget)}\n\`\`\``;
const assistant = (content = fence(board()), id = "assistant-a") => ({
  id,
  role: "assistant",
  content,
});

function fixture() {
  const opens = [];
  const focusSchedules = [];
  const scope = {
    principal: "owner-a",
    conversationId: "chat-a",
    temporary: false,
    temporaryContext: "clean",
    lifetime: 1,
  };
  const { sameNextPromptScope } = loadUiModule("src/lib/chat-send-next.ts", {});
  const context = {
    sameNextPromptScope,
    splitGenerativeContent,
    storagePrincipal: "owner-a",
    activeId: "chat-a",
    principalReady: true,
    isStreaming: false,
    active: { id: "chat-a", messages: [assistant()] },
    pendingCanvasRef: { current: null },
    resultRef: { current: null },
    resultDraftsRef: { current: new Map() },
    resultScopeRef: { current: null },
    resultReturnRef: { current: null },
    nextPromptScopeRef: { current: scope },
    nextPromptMountedRef: { current: true },
    storageGenerationRef: { current: 2 },
    window: { location: { href: "https://local.invalid/?chat=chat-a" } },
    document: { activeElement: null },
    HTMLElement: class {},
    scheduleResultFocus: (...args) => focusSchedules.push(args),
    setResult(next) {
      opens.push(next);
    },
    setResultTab(next) {
      context.tab = next;
    },
    tab: "conversation",
  };
  vm.runInNewContext(compiled, context);
  context.openResult = context.bindOpenResult(scope);
  context.openResultRef = { current: context.openResult };
  context.onOpenResult = context.openResult;
  context.onOpenCanvas = context.bindRouteCanvasOpener();
  const run = (changes = {}) => {
    Object.assign(context, changes);
    context.runAutoWorkspace();
  };
  const stream = (latest = assistant()) =>
    run({ isStreaming: true, active: { id: context.activeId, messages: [latest] } });
  const complete = (latest = context.active.messages.at(-1), changes = {}) =>
    run({
      isStreaming: false,
      active: { id: context.activeId, messages: [latest] },
      ...changes,
    });
  const openWidget = (latest, index = 0) => {
    const part = splitGenerativeContent(latest.content)[index];
    assert.equal(part.kind, "widget");
    context.bindMessageCanvasOpener(latest, index, part)(part.widget, { name: "opener" });
    return part;
  };
  return { context, opens, focusSchedules, run, stream, complete, openWidget };
}

test("same-title widgets keep distinct source identities while reopening preserves only the matching applied draft", () => {
  const f = fixture();
  const first = assistant(fence(board("Project", "First card")));
  const second = assistant(fence(board("Project", "Second card")), "assistant-b");
  const firstPart = f.openWidget(first);
  const appliedDraft = {
    ...f.context.resultRef.current,
    widget: board("Project", "My applied edit"),
  };
  f.context.resultDraftsRef.current.set("owner-a:chat-a", appliedDraft);
  f.openWidget(first);
  assert.equal(f.context.resultRef.current, appliedDraft);

  const secondPart = f.openWidget(second);
  assert.equal(f.context.resultRef.current.widget.cards[0].title, "Second card");
  assert.equal(f.context.resultRef.current.canvasSourceKey, `${second.id}:0:${secondPart.source}`);
  assert.notEqual(f.context.resultRef.current.canvasSourceKey, `${first.id}:0:${firstPart.source}`);

  const response = assistant(`${fence(board())}\n${fence(board())}`, "assistant-two");
  const parts = splitGenerativeContent(response.content);
  const indices = parts.flatMap((part, index) => (part.kind === "widget" ? [index] : []));
  f.openWidget(response, indices[0]);
  const firstIdentity = f.context.resultRef.current.canvasSourceKey;
  f.openWidget(response, indices[1]);
  assert.notEqual(f.context.resultRef.current.canvasSourceKey, firstIdentity);
});

test("fragment editors have a separate source identity and never inherit a widget descriptor", () => {
  const f = fixture();
  const latest = assistant(
    fence({ version: 1, type: "document", title: "Project", content: "Original" }),
  );
  const part = f.openWidget(latest);
  const widgetIdentity = f.context.resultRef.current.canvasSourceKey;
  f.context.bindMessageEditorOpener(latest, 0, part)("Edited fragment", "writing", "Project");
  const descriptor = f.context.resultRef.current;
  assert.equal(descriptor.widget, undefined);
  assert.equal(descriptor.initialContent, "Edited fragment");
  assert.equal(descriptor.canvasSourceKey, `${widgetIdentity}:editor`);
  assert.equal(descriptor.chatId, null);
  assert.equal(descriptor.messageId, null);
});

test("only a newly completed assistant response opens its first validated widget once", () => {
  const f = fixture();
  const latest = assistant(`Here is the board.\n${fence(board())}\n${fence(board("Later"))}`);
  f.stream(latest);
  assert.equal(f.opens.length, 0, "streaming must keep the conversation layout");
  f.complete();
  assert.equal(f.opens.length, 1);
  const firstWidgetIndex = splitGenerativeContent(latest.content).findIndex(
    (part) => part.kind === "widget",
  );
  const firstPart = splitGenerativeContent(latest.content)[firstWidgetIndex];
  assert.equal(f.opens[0].widget.title, "Project");
  assert.equal(f.opens[0].canvasSourceKey, `${latest.id}:${firstWidgetIndex}:${firstPart.source}`);
  assert.equal(f.context.tab, "result");
  assert.equal(f.context.pendingCanvasRef.current, null);
  assert.equal(f.focusSchedules.length, 1);
  f.run();
  assert.equal(f.opens.length, 1, "subsequent renders cannot reopen a completed response");
});

test("historical replies and invalid or unfinished widget payloads do not shift layout", () => {
  const f = fixture();
  f.run();
  assert.equal(f.opens.length, 0, "loading existing history is not a new completion");
  for (const content of [
    "Plain answer",
    '```kova-ui\n{"version":1',
    fence({ version: 1, type: "iframe", title: "Invalid" }),
  ]) {
    f.stream(assistant(content));
    f.complete();
    assert.equal(f.opens.length, 0);
    assert.equal(f.context.pendingCanvasRef.current, null);
  }
});

for (const generationStatus of ["failed", "stopped"]) {
  test(`${generationStatus} partial responses never shift layout even with a valid complete widget`, () => {
    const f = fixture();
    const latest = assistant();
    f.stream(latest);
    f.complete({ ...latest, generationStatus });
    assert.equal(f.opens.length, 0);
    assert.equal(f.context.tab, "conversation");
    assert.equal(f.context.pendingCanvasRef.current, null);
    f.complete(latest);
    assert.equal(f.opens.length, 0, "clearing a marker cannot replay the consumed completion");
  });
}

test("an existing workspace or applied conversation draft prevents automatic replacement", () => {
  for (const existing of ["workspace", "draft"]) {
    const f = fixture();
    const preserved = { title: "My existing result", initialContent: "Keep my edit" };
    if (existing === "workspace") f.context.resultRef.current = preserved;
    else f.context.resultDraftsRef.current.set("owner-a:chat-a", preserved);
    f.stream();
    f.complete();
    assert.equal(f.opens.length, 0, existing);
    assert.equal(
      existing === "workspace"
        ? f.context.resultRef.current
        : f.context.resultDraftsRef.current.get("owner-a:chat-a"),
      preserved,
    );
  }
});

test("a completion from a different account or conversation cannot shift the current workspace", () => {
  for (const changes of [{ storagePrincipal: "owner-b" }, { activeId: "chat-b" }]) {
    const f = fixture();
    f.stream();
    f.complete(undefined, changes);
    assert.equal(f.opens.length, 0);
    assert.equal(f.context.pendingCanvasRef.current, null);
  }
});

test("a replaced latest message, user message, or unavailable principal cannot trigger a layout shift", () => {
  for (const [latest, changes] of [
    [assistant(undefined, "assistant-other"), {}],
    [{ ...assistant(), role: "user" }, {}],
    [assistant(), { principalReady: false }],
  ]) {
    const f = fixture();
    f.stream();
    f.complete(latest, changes);
    assert.equal(f.opens.length, 0);
    assert.equal(f.context.pendingCanvasRef.current, null);
  }
});

test("automatic opening still respects the live route mount and prompt-scope guards", () => {
  for (const guard of ["unmounted", "stale-scope"]) {
    const f = fixture();
    f.stream();
    if (guard === "unmounted") f.context.nextPromptMountedRef.current = false;
    else
      f.context.nextPromptScopeRef.current = {
        ...f.context.nextPromptScopeRef.current,
        lifetime: 2,
      };
    f.complete();
    assert.equal(f.opens.length, 0, guard);
    assert.equal(f.context.tab, "conversation");
  }
});
